/**
 * @file handler.ts
 * @description Prepares a form-bound profile avatar upload from authoritative admin state.
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
    InitiateAdminAvatarChangeCommand,
    type InitiateAdminAvatarChangeResult,
} from 'src/module/admin/application/command/initiate-admin-avatar-change/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    ADMIN_AVATAR_CHANGE_UPLOAD_TOKEN_TTL_SECONDS,
    ADMIN_AVATAR_CHANGE_UPLOAD_URL_TTL_SECONDS,
    createAdminAvatarChangeFormHash,
} from 'src/module/admin/domain/admin-avatar-change';
import { buildAdminPendingAvatarKey } from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import type { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AVATAR_PENDING_CACHE_POLICY } from 'src/shared/domain/avatar';
import { ResourceNotFoundException, SystemException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Authorizes one conditional PUT for the authenticated account's next avatar version.
 */
@CommandHandler(InitiateAdminAvatarChangeCommand)
export class InitiateAdminAvatarChangeCommandHandler implements ICommandHandler<
    InitiateAdminAvatarChangeCommand,
    InitiateAdminAvatarChangeResult
> {
    /**
     * Server-only key protecting profile form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes upload authorization dependencies.
     *
     * @param adminWriterPort Reads live account state on the primary
     * @param tokenPort Signs the profile-owned upload proof
     * @param storagePort Signs the conditional avatar PUT
     * @param configService Provides the validated upload secret
     * @param auditPort Records workflow refusal evidence
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        configService: ConfigService,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Issues a short-lived upload plan without persisting profile changes.
     *
     * @param command Owner identity, avatar descriptor, and optional normalized name
     * @returns Signed PUT and the proof accepted by profile update
     * @throws {ResourceNotFoundException} When the account is missing or deleted
     * @throws {AccessDeniedException} When the account is banned
     * @throws {DependencyUnavailableException} When database, storage, or audit persistence is unavailable
     * @throws {SystemException} When the account is inactive or the storage plan violates the contract
     */
    async execute(command: InitiateAdminAvatarChangeCommand): Promise<InitiateAdminAvatarChangeResult> {
        const admin: Admin = await this.loadAdmin(command.id);

        try {
            admin.assertAvatarChangeEligible();
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        const avatarId = randomUUID(),
            fileKey = buildAdminPendingAvatarKey(admin.id, avatarId),
            now = Math.floor(Date.now() / 1000),
            plan = await this.storagePort.initiateUpload({
                key: fileKey,
                sizeBytes: command.avatar.sizeBytes,
                contentType: command.avatar.contentType,
                cache: AVATAR_PENDING_CACHE_POLICY,
                deadline: new Date((now + ADMIN_AVATAR_CHANGE_UPLOAD_URL_TTL_SECONDS) * 1000),
            });

        if (plan.mode !== 'single') {
            throw new SystemException('Avatar upload requires a single PUT plan.', {
                context: { class: InitiateAdminAvatarChangeCommandHandler.name, method: this.execute.name },
            });
        }

        return {
            mode: plan.mode,
            request: plan.request,
            uploadToken: await this.tokenPort.generateUploadToken({
                sub: admin.id,
                jti: avatarId,
                revocationVersion: admin.revocationVersion,
                purpose: AdminUploadPurpose.PROFILE_AVATAR,
                fileKey,
                formHash: createAdminAvatarChangeFormHash(
                    {
                        id: admin.id,
                        avatarId,
                        ...(command.name !== undefined && { name: command.name }),
                        avatar: command.avatar,
                    },
                    this.uploadSecret,
                ),
                exp: now + ADMIN_AVATAR_CHANGE_UPLOAD_TOKEN_TTL_SECONDS,
            }),
        };
    }

    /**
     * Loads an existing admin so eligibility assertions receive a non-null account.
     *
     * @param id Account identity from the authenticated principal
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
