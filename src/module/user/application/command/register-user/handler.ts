/**
 * @file handler.ts
 * @description Verifies registration upload proof and atomically persists the pending User, deliveries, and audit.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import type { ITokenPort } from 'src/core/security/token';
import {
    TOKEN_STORAGE_PORT,
    TOKEN_UPLOAD_TOKEN_PORT,
    type IStoragePort,
    type UploadTokenPayload,
} from 'src/core/storage';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { RegisterUserCommand } from 'src/module/user/application/command/register-user/command';
import { UserUploadTokenType } from 'src/module/user/application/user-upload-token';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { canonicalizeUserRegistrationForm } from 'src/module/user/domain/user-registration';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import { assertAvatarUploadMatchesDescriptor } from 'src/shared/domain/avatar';
import {
    ExceptionKind,
    InvalidInputException,
    InvalidInputMessage,
    SystemException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Registers a pending user with its uploaded avatar and activation and avatar deliveries.
 */
@CommandHandler(RegisterUserCommand)
export class RegisterUserCommandHandler implements ICommandHandler<RegisterUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param idempotencyPort The commit boundary for the account, delivery jobs, and audit
     * @param userWriterPort The port used to persist the user aggregate and its jobs
     * @param hashingPort Hashes passwords and verifies registration form bindings
     * @param auditPort The port used to record the pending registration
     * @param uploadTokenPort Verifies the workflow-owned upload proof
     * @param storagePort Checks the actual uploaded object before opening a transaction
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_UPLOAD_TOKEN_PORT)
        private readonly uploadTokenPort: ITokenPort<typeof UserUploadTokenType.REGISTRATION>,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
    ) {}

    /**
     * Verifies the uploaded avatar and commits the pending account, delivery jobs, and audit together.
     *
     * @param command The command payload
     * @throws {InvalidInputException} When the upload proof is invalid or expired, or the form or uploaded object differs from the proof
     * @throws {ResourceConflictException} When the identity or email address already exists
     * @throws {DependencyUnavailableException} When storage or required database persistence is unavailable
     * @throws {SystemException} When verified upload claims violate registration invariants, storage authorization fails, or the queue does not accept every job
     */
    async execute(command: RegisterUserCommand) {
        await this.idempotencyPort.executePrepared(
            command.idempotencyRequest,
            async () => {
                let payload: UploadTokenPayload<UserUploadTokenType.REGISTRATION>;

                try {
                    payload = await this.uploadTokenPort.verify<UploadTokenPayload<UserUploadTokenType.REGISTRATION>>(
                        command.uploadToken,
                        UserUploadTokenType.REGISTRATION,
                    );
                } catch (error) {
                    if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                        throw new InvalidInputException('The upload proof is invalid or has expired.', {
                            cause: error,
                        });
                    }

                    throw error;
                }

                if (payload.fileKey !== buildUserPendingAvatarKey(payload.sub, payload.sub)) {
                    throw new SystemException(
                        'Verified upload file key does not match the registration pending avatar key.',
                        {
                            context: { class: this.constructor.name, method: this.execute.name },
                        },
                    );
                }

                if (
                    !this.hashingPort.verifyHmacSha256(
                        UserUploadTokenType.REGISTRATION,
                        canonicalizeUserRegistrationForm({
                            email: command.email,
                            name: command.name,
                            password: command.password,
                            avatar: command.avatar,
                        }),
                        payload.formHash,
                    )
                ) {
                    throw new InvalidInputException();
                }

                let avatar;

                try {
                    avatar = await this.storagePort.headObject(payload.fileKey);
                } catch (error) {
                    if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                        throw new InvalidInputException(InvalidInputMessage.DEFAULT, { cause: error });
                    }

                    throw error;
                }

                assertAvatarUploadMatchesDescriptor(avatar, command.avatar);

                return { payload, passwordHash: await this.hashingPort.hashPassword(command.password) };
            },
            async ({ payload, passwordHash }) => {
                let user;

                try {
                    user = User.create({
                        id: payload.sub,
                        email: command.email,
                        name: command.name,
                        password: passwordHash,
                        avatarKey: payload.fileKey,
                    });
                } catch (error) {
                    if (isExceptionWithAudit(error)) {
                        await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
                    }

                    throw error;
                }

                await this.userWriterPort.insert(user);
                await this.auditPort.record({ action: UserAuditAction.USER_REGISTERED, targetId: user.id });

                return { replayResultId: null };
            },
        );
    }
}
