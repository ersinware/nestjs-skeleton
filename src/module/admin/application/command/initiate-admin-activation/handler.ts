/**
 * @file handler.ts
 * @description Prepares a form-bound admin avatar upload without consuming the invitation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { type ITokenPort } from 'src/core/security/token';
import {
    TOKEN_STORAGE_PORT,
    TOKEN_UPLOAD_TOKEN_PORT,
    type IStoragePort,
    type UploadTokenPayload,
} from 'src/core/storage';
import {
    ADMIN_INVITE_TOKEN_TYPE,
    TOKEN_ADMIN_INVITE_TOKEN_PORT,
    type InviteTokenPayload,
} from 'src/module/admin/application/admin-invite-token';
import { AdminUploadTokenType } from 'src/module/admin/application/admin-upload-token';
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
    canonicalizeAdminActivationForm,
} from 'src/module/admin/domain/admin-activation';
import { buildAdminPendingAvatarKey } from 'src/module/admin/domain/admin-avatar-key.util';
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
import { nowEpochSeconds } from 'src/shared/time';

/**
 * Authorizes one conditional PUT using the account's live invitation and fixed deadline.
 */
@CommandHandler(InitiateAdminActivationCommand)
export class InitiateAdminActivationCommandHandler implements ICommandHandler<
    InitiateAdminActivationCommand,
    InitiateAdminActivationResult
> {
    /**
     * Initializes upload authorization dependencies.
     *
     * @param adminWriterPort Reads live invitation state on the primary
     * @param inviteTokenPort Verifies invitation tokens
     * @param uploadTokenPort Signs activation avatar upload proofs
     * @param storagePort Signs the conditional avatar request
     * @param auditPort Records audited invitation refusals
     * @param hashingPort Produces and verifies workflow form bindings
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_ADMIN_INVITE_TOKEN_PORT)
        private readonly inviteTokenPort: ITokenPort<typeof ADMIN_INVITE_TOKEN_TYPE>,
        @Inject(TOKEN_UPLOAD_TOKEN_PORT)
        private readonly uploadTokenPort: ITokenPort<typeof AdminUploadTokenType.ACTIVATION>,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
    ) {}

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
        let payload: InviteTokenPayload;

        try {
            payload = await this.inviteTokenPort.verify<InviteTokenPayload>(command.token, ADMIN_INVITE_TOKEN_TYPE);
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
            now = nowEpochSeconds(),
            plan = await this.storagePort.initiateUpload({
                key: fileKey,
                sizeBytes: command.avatar.sizeBytes,
                contentType: command.avatar.contentType,
                cache: AVATAR_PENDING_CACHE_POLICY,
                deadline: new Date(Math.min(now + ADMIN_ACTIVATION_UPLOAD_URL_TTL_SECONDS, exp) * 1000),
            });

        if (plan.mode !== 'single') {
            throw new SystemException('Avatar upload requires a single PUT plan.', {
                context: { class: this.constructor.name, method: this.execute.name },
            });
        }

        return {
            mode: plan.mode,
            request: plan.request,
            uploadToken: await this.uploadTokenPort.sign<UploadTokenPayload<AdminUploadTokenType.ACTIVATION>>(
                AdminUploadTokenType.ACTIVATION,
                {
                    sub,
                    jti: randomUUID(),
                    fileKey,
                    formHash: this.hashingPort.hmacSha256(
                        AdminUploadTokenType.ACTIVATION,
                        canonicalizeAdminActivationForm({
                            id: sub,
                            inviteId: jti,
                            password: command.password,
                            avatar: command.avatar,
                        }),
                    ),
                    exp: Math.min(now + ADMIN_ACTIVATION_UPLOAD_TOKEN_TTL_SECONDS, exp),
                },
            ),
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
