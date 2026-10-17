/**
 * @file handler.ts
 * @description Handles ActivateAdminCommand. Verifies the invite token against the account's live state and sets the first password.
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
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { assertAdminActivationFormHashMatches } from 'src/module/admin/domain/admin-activation';
import { buildAdminPendingAvatarKey } from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import { assertAvatarUploadMatchesDescriptor } from 'src/shared/domain/avatar';
import {
    ExceptionKind,
    InvalidInputException,
    InvalidInputMessage,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Activates a pending admin account. Verification is two-layered: the token's signature and expiry,
 * then the persisted invitation and live account state. Activation consumes the invitation metadata
 * while setting the first password and pending avatar with their durable move job.
 */
@CommandHandler(ActivateAdminCommand)
export class ActivateAdminCommandHandler implements ICommandHandler<ActivateAdminCommand, void> {
    /**
     * Server-only key used to verify credential form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param tokenPort The port used to verify the invite token
     * @param hashingPort The port used to hash the initial password
     * @param auditPort The port used to record activation and audited refusals
     * @param storagePort Checks actual uploaded metadata before the database transaction
     * @param configService Provides the validated upload secret
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        configService: ConfigService,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Executes the activate admin command.
     *
     * @param command The command payload
     * @throws {InvalidInputException} When the invitation or upload proof is invalid or expired, or the form binding or uploaded metadata does not match
     * @throws {ResourceNotFoundException} When the verified invitation refers to a missing account
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active or changed concurrently
     * @throws {SystemException} When the loaded account is deleted or differs from the verified subject
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    async execute(command: ActivateAdminCommand) {
        let payload;

        try {
            payload = await this.tokenPort.verifyInviteToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new InvalidInputException('The invitation is invalid or has expired.', { cause: error });
            }

            throw error;
        }

        const admin = await this.adminWriterPort.load(payload.sub);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        let payloadUpload;

        try {
            payloadUpload = await this.tokenPort.verifyUploadToken(command.uploadToken, AdminUploadPurpose.ACTIVATION);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new InvalidInputException('The upload proof is invalid or has expired.', { cause: error });
            }

            throw error;
        }

        if (
            payloadUpload.sub !== payload.sub ||
            payloadUpload.fileKey !== buildAdminPendingAvatarKey(payload.sub, payload.jti) ||
            payloadUpload.exp > payload.exp
        ) {
            throw new InvalidInputException();
        }

        assertAdminActivationFormHashMatches(
            {
                id: payload.sub,
                inviteId: payload.jti,
                password: command.password,
                avatar: command.avatar,
            },
            this.uploadSecret,
            payloadUpload.formHash,
        );

        let avatar;

        try {
            avatar = await this.storagePort.headObject(payloadUpload.fileKey);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                throw new InvalidInputException(InvalidInputMessage.DEFAULT, { cause: error });
            }

            throw error;
        }

        assertAvatarUploadMatchesDescriptor(avatar, command.avatar);

        try {
            admin.activate(await this.hashingPort.hash(command.password), payload, payloadUpload.fileKey);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AuditAction.ADMIN_ACTIVATED, targetId: admin.id });
        });
    }
}
