/**
 * @file handler.ts
 * @description Prepares a form-bound admin avatar upload without consuming the invitation.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { ENV } from 'src/core/config';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage';
import {
    InitiateAdminActivationCommand,
    type InitiateAdminActivationResult,
} from 'src/module/admin/application/command/initiate-admin-activation/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    ADMIN_ACTIVATION_UPLOAD_TOKEN_TTL_SECONDS,
    ADMIN_ACTIVATION_UPLOAD_URL_TTL_SECONDS,
    createAdminActivationFormHash,
} from 'src/module/admin/domain/admin-activation';
import { buildAdminPendingAvatarKey } from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import type { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AVATAR_PENDING_CACHE_POLICY } from 'src/shared/domain/avatar';
import {
    ExceptionKind,
    InvalidInputException,
    ResourceNotFoundException,
    SystemException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Authorizes one conditional PUT using the account's live invitation and fixed deadline.
 */
@CommandHandler(InitiateAdminActivationCommand)
export class InitiateAdminActivationCommandHandler implements ICommandHandler<
    InitiateAdminActivationCommand,
    InitiateAdminActivationResult
> {
    /**
     * Server-only key protects credential-containing form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes upload authorization dependencies.
     *
     * @param adminWriterPort Reads live invitation state on the primary
     * @param tokenPort Verifies invitations and signs workflow-owned upload proofs
     * @param storagePort Signs the conditional avatar request
     * @param auditPort Records audited invitation refusals
     * @param configService Provides the validated upload secret
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        configService: ConfigService,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Prepares an upload whose URL and proof cannot outlive the invitation.
     *
     * @param command Validated invitation, password, and avatar descriptor
     * @returns One signed PUT and the proof accepted by activation
     * @throws {InvalidInputException} When the invitation is invalid, expired, or revoked
     * @throws {ResourceNotFoundException} When the account is missing or deleted
     * @throws {ResourceConflictException} When the account is already active
     * @throws {AccessDeniedException} When the account is banned
     * @throws {DependencyUnavailableException} When database or storage is unavailable
     * @throws {SystemException} When invitation identity or the storage plan violates the contract
     */
    async execute(command: InitiateAdminActivationCommand): Promise<InitiateAdminActivationResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyInviteToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new InvalidInputException('The invitation is invalid or has expired.', { cause: error });
            }

            throw error;
        }

        const { sub, jti, exp } = payload,
            admin: Admin = await this.loadAdmin(sub);

        try {
            admin.assertActivationInvitationValid(payload);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        const fileKey = buildAdminPendingAvatarKey(sub, jti),
            now = Math.floor(Date.now() / 1000),
            plan = await this.storagePort.initiateUpload({
                key: fileKey,
                sizeBytes: command.avatar.sizeBytes,
                contentType: command.avatar.contentType,
                cache: AVATAR_PENDING_CACHE_POLICY,
                deadline: new Date(Math.min(now + ADMIN_ACTIVATION_UPLOAD_URL_TTL_SECONDS, exp) * 1000),
            });

        if (plan.mode !== 'single') {
            throw new SystemException('Avatar upload requires a single PUT plan.', {
                context: { class: InitiateAdminActivationCommandHandler.name, method: this.execute.name },
            });
        }

        return {
            mode: plan.mode,
            request: plan.request,
            uploadToken: await this.tokenPort.generateUploadToken({
                sub,
                jti: randomUUID(),
                purpose: AdminUploadPurpose.ACTIVATION,
                fileKey,
                formHash: createAdminActivationFormHash(
                    {
                        id: sub,
                        inviteId: jti,
                        password: command.password,
                        avatar: command.avatar,
                    },
                    this.uploadSecret,
                ),
                exp: Math.min(now + ADMIN_ACTIVATION_UPLOAD_TOKEN_TTL_SECONDS, exp),
            }),
        };
    }

    /**
     * Loads an existing admin so invitation assertions receive a non-null account.
     *
     * @param id Account identity from the verified invitation
     * @returns The existing admin aggregate
     * @throws {ResourceNotFoundException} When the account is missing or deleted
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
