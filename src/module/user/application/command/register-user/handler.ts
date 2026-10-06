/**
 * @file handler.ts
 * @description Verifies registration upload proof and atomically persists the pending User, deliveries, and audit.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { RegisterUserCommand } from 'src/module/user/application/command/register-user/command';
import {
    TOKEN_IS_USER_EMAIL_IN_USE_PORT,
    type IIsUserEmailInUsePort,
} from 'src/module/user/application/query/is-user-email-in-use/port';
import { TOKEN_USER_EXISTS_PORT, type IUserExistsPort } from 'src/module/user/application/query/user-exists/port';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { assertUserRegistrationFormHashMatches } from 'src/module/user/domain/user-registration';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { isUUIDV7 } from 'src/shared/domain/uuid';
import {
    ExceptionKind,
    InvalidInputException,
    InvalidInputMessage,
    ResourceConflictException,
    ResourceConflictMessage,
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
     * Server-only key used to verify the normalized credential form binding.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the account, delivery jobs, and audit
     * @param userWriterPort The port used to persist the user aggregate and its jobs
     * @param hashingPort The port used to hash passwords
     * @param auditPort The port used to record the pending registration
     * @param tokenPort Verifies the workflow-owned upload proof
     * @param storagePort Checks the actual uploaded object before opening a transaction
     * @param configService Provides the validated form binding secret
     * @param emailInUsePort Rejects already consumed registrations before checking a cleaned-up source
     * @param userExistsPort Checks whether the registration identity is already persisted
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        configService: ConfigService,
        @Inject(TOKEN_IS_USER_EMAIL_IN_USE_PORT) private readonly emailInUsePort: IIsUserEmailInUsePort,
        @Inject(TOKEN_USER_EXISTS_PORT) private readonly userExistsPort: IUserExistsPort,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Verifies the uploaded avatar and commits the pending account, delivery jobs, and audit together.
     *
     * @param command The command payload
     * @throws {UnauthenticatedException} When the upload proof is invalid or expired
     * @throws {InvalidInputException} When the form or uploaded object differs from the proof
     * @throws {ResourceConflictException} When the identity or email address already exists
     * @throws {DependencyUnavailableException} When storage or required database persistence is unavailable
     * @throws {SystemException} When verified upload claims violate registration invariants, storage authorization fails, or the queue does not accept every job
     */
    async execute(command: RegisterUserCommand) {
        const payload = await this.tokenPort.verifyUploadToken(command.uploadToken, UserUploadPurpose.REGISTRATION);

        assertUserRegistrationFormHashMatches(command, this.uploadSecret, payload.formHash);

        if (!isUUIDV7(payload.sub)) {
            throw new SystemException('Verified upload subject is not a UUID v7 registration identity.', {
                context: { class: RegisterUserCommandHandler.name, method: this.execute.name },
            });
        }

        if (payload.fileKey !== buildUserPendingAvatarKey(payload.sub)) {
            throw new SystemException('Verified upload file key does not match the registration pending avatar key.', {
                context: { class: RegisterUserCommandHandler.name, method: this.execute.name },
            });
        }

        // These reads improve replay responses; the plain INSERT still protects concurrent requests.
        if ((await this.userExistsPort.existsById(payload.sub)).exists) {
            throw new ResourceConflictException();
        }

        if ((await this.emailInUsePort.isEmailInUse(command.email)).isInUse) {
            throw new ResourceConflictException(ResourceConflictMessage.EMAIL_IN_USE);
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

        if (avatar.sizeBytes !== command.avatar.sizeBytes || avatar.contentType !== command.avatar.contentType) {
            throw new InvalidInputException();
        }

        let user;

        try {
            user = User.create({
                id: payload.sub,
                email: command.email,
                name: command.name,
                password: await this.hashingPort.hash(command.password),
                avatarKey: payload.fileKey,
            });
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.insert(user);
            await this.auditPort.record({ action: AuditAction.USER_REGISTERED, targetId: user.id });
        });
    }
}
