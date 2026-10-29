/**
 * @file handler.ts
 * @description Accepts optional name and uploaded avatar changes with atomic persistence, jobs, and audit.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { assertAdminAvatarChangeFormHashMatches } from 'src/module/admin/domain/admin-avatar-change';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import type { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { AuditReason } from 'src/shared/domain/audit';
import { assertAvatarUploadMatchesDescriptor } from 'src/shared/domain/avatar';
import {
    AccessDeniedException,
    ExceptionKind,
    InvalidInputException,
    InvalidInputMessage,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Updates the profile from authoritative state after verifying any uploaded avatar.
 */
@CommandHandler(UpdateAdminCommand)
export class UpdateAdminCommandHandler implements ICommandHandler<UpdateAdminCommand, void> {
    /**
     * Server-only key used to verify profile form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param auditPort The port used to record profile changes and audited refusals
     * @param tokenPort Verifies profile-owned upload proofs
     * @param storagePort Checks uploaded metadata outside the database transaction
     * @param configService Provides the validated upload secret
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        configService: ConfigService,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Executes the update admin command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When the avatar proof is replayed or persistence rejects a concurrent modification
     * @throws {SystemException} When the loaded account is deleted or inactive, or verified upload keys violate invariants
     * @throws {AccessDeniedException} When the avatar proof belongs to another account or the account is banned
     * @throws {InvalidInputException} When no update is supplied, the avatar descriptor and proof are not supplied together, the upload proof is invalid or expired, or the profile binding or uploaded metadata does not match
     */
    async execute(command: UpdateAdminCommand) {
        const { name, avatar, uploadToken } = command;

        if (name === undefined && avatar === undefined && uploadToken === undefined) {
            throw new InvalidInputException();
        }

        if ((avatar === undefined) !== (uploadToken === undefined)) {
            throw new InvalidInputException();
        }

        const admin: Admin = await this.loadAdmin(command.id);

        let avatarUpdate: Parameters<Admin['update']>[1];

        if (avatar !== undefined && uploadToken !== undefined) {
            let payload;

            try {
                payload = await this.tokenPort.verifyUploadToken(uploadToken, AdminUploadPurpose.PROFILE_AVATAR, true);
            } catch (error) {
                if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                    throw new InvalidInputException('The upload proof is invalid or has expired.', { cause: error });
                }

                throw error;
            }

            if (payload.sub !== admin.id) {
                const error = new AccessDeniedException();

                await this.auditPort.record(
                    {
                        action: AdminAuditAction.ADMIN_UPDATE_FAILED,
                        reason: AuditReason.PRINCIPAL_MISMATCH,
                        targetId: payload.sub,
                    },
                    { markExceptionAsAudited: error },
                );

                throw error;
            }

            avatarUpdate = {
                fileKey: payload.fileKey,
                jti: payload.jti,
                revocationVersion: payload.revocationVersion,
            };

            try {
                admin.assertProfileUpdateAllowed(avatarUpdate);
            } catch (error) {
                if (isExceptionWithAudit(error)) {
                    await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
                }

                throw error;
            }

            assertAdminAvatarChangeFormHashMatches(
                {
                    id: admin.id,
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
        }

        let changed: boolean;

        try {
            changed = admin.update(name, avatarUpdate);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        if (!changed) {
            return;
        }

        await this.transactionPort.start(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AdminAuditAction.ADMIN_UPDATED });
        });
    }

    /**
     * Loads the profile owner or rejects an unavailable account.
     *
     * @param id Account identity
     * @returns The non-deleted account aggregate
     * @throws {ResourceNotFoundException} When no non-deleted account exists with the given ID
     * @throws {DependencyUnavailableException} When the database is unavailable
     */
    private async loadAdmin(id: string): Promise<Admin> {
        const admin = await this.adminWriterPort.load(id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        return admin;
    }
}
