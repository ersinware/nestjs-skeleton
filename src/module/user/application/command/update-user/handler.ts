/**
 * @file handler.ts
 * @description Accepts optional name and uploaded avatar changes with atomic persistence, jobs, and audit.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import type { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { assertUserAvatarChangeFormHashMatches } from 'src/module/user/domain/user-avatar-change';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { assertAvatarUploadMatchesDescriptor } from 'src/shared/domain/avatar';
import {
    AccessDeniedException,
    ExceptionKind,
    InvalidInputException,
    InvalidInputMessage,
    ResourceNotFoundException,
    SystemException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Profile update refusals decided before aggregate validation.
 */
enum UpdateUserFailureAuditAction {
    /**
     * A profile update was refused.
     */
    USER_UPDATE_FAILED = 'USER_UPDATE_FAILED',
}

/**
 * Refusal reasons decided before aggregate validation.
 */
enum UpdateUserRejectionReason {
    /**
     * Verified upload proof belongs to another account.
     */
    PRINCIPAL_MISMATCH = 'PRINCIPAL_MISMATCH',
}

/**
 * Updates the profile from authoritative state after verifying any uploaded avatar.
 */
@CommandHandler(UpdateUserCommand)
export class UpdateUserCommandHandler implements ICommandHandler<UpdateUserCommand, void> {
    /**
     * Server-only key used to verify profile form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param userWriterPort The port used to load and save the user aggregate
     * @param auditPort The port used to record profile changes and audited refusals
     * @param tokenPort Verifies profile-owned upload proofs
     * @param storagePort Checks uploaded metadata outside the database transaction
     * @param configService Provides the validated upload secret
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        configService: ConfigService,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Executes the update user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When the avatar proof is replayed or persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account is deleted or pending activation, or verified upload keys violate invariants
     * @throws {AccessDeniedException} When the avatar proof belongs to another account or the account is banned
     * @throws {InvalidInputException} When no update is supplied, the avatar descriptor and proof are not supplied together, the upload proof is invalid or expired, or the profile binding or uploaded metadata does not match
     */
    async execute(command: UpdateUserCommand) {
        const { name, avatar, uploadToken } = command;

        if (name === undefined && avatar === undefined && uploadToken === undefined) {
            throw new InvalidInputException();
        }

        if ((avatar === undefined) !== (uploadToken === undefined)) {
            throw new InvalidInputException();
        }

        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        let avatarUpdate: Parameters<User['update']>[1];

        if (avatar !== undefined && uploadToken !== undefined) {
            let payload;

            try {
                payload = await this.tokenPort.verifyUploadToken(uploadToken, UserUploadPurpose.PROFILE_AVATAR, true);
            } catch (error) {
                if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                    throw new InvalidInputException('The upload proof is invalid or has expired.', { cause: error });
                }

                throw error;
            }

            if (payload.sub !== user.id) {
                const error = new AccessDeniedException();

                await this.auditPort.record(
                    {
                        action: UpdateUserFailureAuditAction.USER_UPDATE_FAILED,
                        reason: UpdateUserRejectionReason.PRINCIPAL_MISMATCH,
                        targetId: payload.sub,
                    },
                    { markExceptionAsAudited: error },
                );

                throw error;
            }

            if (payload.fileKey !== buildUserPendingAvatarKey(user.id, payload.jti)) {
                throw new SystemException('Verified profile upload claims violate avatar key invariants.', {
                    context: { class: UpdateUserCommandHandler.name, method: this.execute.name },
                });
            }

            try {
                user.assertAvatarReplacementAllowed(payload.jti);
            } catch (error) {
                if (isExceptionWithAudit(error)) {
                    await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
                }

                throw error;
            }

            assertUserAvatarChangeFormHashMatches(
                {
                    id: user.id,
                    avatarId: payload.jti,
                    ...(name !== undefined && { name }),
                    avatar,
                },
                this.uploadSecret,
                payload.formHash,
            );

            let uploaded;

            try {
                uploaded = await this.storagePort.headObject(payload.fileKey);
            } catch (error) {
                if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                    throw new InvalidInputException(InvalidInputMessage.DEFAULT, { cause: error });
                }

                throw error;
            }

            assertAvatarUploadMatchesDescriptor(uploaded, avatar);

            avatarUpdate = {
                fileKey: payload.fileKey,
                jti: payload.jti,
                revocationVersion: payload.revocationVersion,
            };
        }

        let changed: boolean;

        try {
            changed = user.update(name, avatarUpdate);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        if (!changed) {
            return;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: AuditAction.USER_UPDATED });
        });
    }
}
