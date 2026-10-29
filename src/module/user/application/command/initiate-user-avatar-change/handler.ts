/**
 * @file handler.ts
 * @description Prepares a form-bound profile avatar upload from authoritative user state.
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
    InitiateUserAvatarChangeCommand,
    type InitiateUserAvatarChangeResult,
} from 'src/module/user/application/command/initiate-user-avatar-change/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import type { User } from 'src/module/user/domain/aggregate/user.aggregate';
import {
    USER_AVATAR_CHANGE_UPLOAD_TOKEN_TTL_SECONDS,
    USER_AVATAR_CHANGE_UPLOAD_URL_TTL_SECONDS,
    createUserAvatarChangeFormHash,
} from 'src/module/user/domain/user-avatar-change';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { AVATAR_PENDING_CACHE_POLICY } from 'src/shared/domain/avatar';
import { ResourceNotFoundException, SystemException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Authorizes one conditional PUT for the authenticated account's next avatar version.
 */
@CommandHandler(InitiateUserAvatarChangeCommand)
export class InitiateUserAvatarChangeCommandHandler implements ICommandHandler<
    InitiateUserAvatarChangeCommand,
    InitiateUserAvatarChangeResult
> {
    /**
     * Server-only key protecting profile form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes upload authorization dependencies.
     *
     * @param userWriterPort Reads live account state on the primary
     * @param tokenPort Signs the profile-owned upload proof
     * @param storagePort Signs the conditional avatar PUT
     * @param configService Provides the validated upload secret
     * @param auditPort Records workflow refusal evidence
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
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
     * @throws {SystemException} When the account is pending activation or the storage plan violates the contract
     */
    async execute(command: InitiateUserAvatarChangeCommand): Promise<InitiateUserAvatarChangeResult> {
        const user: User = await this.loadUser(command.id);

        try {
            user.assertAvatarChangeEligible();
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        const avatarId = randomUUID(),
            fileKey = buildUserPendingAvatarKey(user.id, avatarId),
            now = Math.floor(Date.now() / 1000),
            plan = await this.storagePort.initiateUpload({
                key: fileKey,
                sizeBytes: command.avatar.sizeBytes,
                contentType: command.avatar.contentType,
                cache: AVATAR_PENDING_CACHE_POLICY,
                deadline: new Date((now + USER_AVATAR_CHANGE_UPLOAD_URL_TTL_SECONDS) * 1000),
            });

        if (plan.mode !== 'single') {
            throw new SystemException('Avatar upload requires a single PUT plan.', {
                context: { class: this.constructor.name, method: this.execute.name },
            });
        }

        return {
            mode: plan.mode,
            request: plan.request,
            uploadToken: await this.tokenPort.generateUploadToken({
                sub: user.id,
                jti: avatarId,
                revocationVersion: user.revocationVersion,
                purpose: UserUploadPurpose.PROFILE_AVATAR,
                fileKey,
                formHash: createUserAvatarChangeFormHash(
                    {
                        id: user.id,
                        avatarId,
                        ...(command.name !== undefined && { name: command.name }),
                        avatar: command.avatar,
                    },
                    this.uploadSecret,
                ),
                exp: now + USER_AVATAR_CHANGE_UPLOAD_TOKEN_TTL_SECONDS,
            }),
        };
    }

    /**
     * Loads an existing user so eligibility assertions receive a non-null account.
     *
     * @param id Account identity from the authenticated principal
     * @returns The existing user aggregate
     * @throws {ResourceNotFoundException} When the account is missing or deleted
     * @throws {DependencyUnavailableException} When the database is unavailable
     */
    private async loadUser(id: string): Promise<User> {
        const user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        return user;
    }
}
