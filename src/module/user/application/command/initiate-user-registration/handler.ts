/**
 * @file handler.ts
 * @description Prepares one form-bound user avatar upload without persisting account state.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { ENV } from 'src/core/config';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage';
import {
    InitiateUserRegistrationCommand,
    type InitiateUserRegistrationResult,
} from 'src/module/user/application/command/initiate-user-registration/command';
import {
    TOKEN_IS_USER_EMAIL_IN_USE_PORT,
    type IIsUserEmailInUsePort,
} from 'src/module/user/application/query/is-user-email-in-use/port';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import {
    USER_REGISTRATION_UPLOAD_TOKEN_TTL_SECONDS,
    USER_REGISTRATION_UPLOAD_URL_TTL_SECONDS,
    createUserRegistrationFormHash,
} from 'src/module/user/domain/user-registration';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { AVATAR_PENDING_CACHE_POLICY } from 'src/shared/domain/avatar';
import { ResourceConflictException, ResourceConflictMessage, SystemException } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Issues a fresh upload attempt after an authoritative email availability check.
 */
@CommandHandler(InitiateUserRegistrationCommand)
export class InitiateUserRegistrationCommandHandler implements ICommandHandler<
    InitiateUserRegistrationCommand,
    InitiateUserRegistrationResult
> {
    /**
     * Server-only key protects credential-containing form bindings.
     */
    private readonly uploadSecret: string;

    /**
     * Initializes upload authorization dependencies.
     *
     * @param emailInUsePort Reads address availability on the primary
     * @param storagePort Signs the conditional upload request
     * @param tokenPort Signs workflow-owned upload claims
     * @param configService Provides the validated upload secret
     */
    constructor(
        @Inject(TOKEN_IS_USER_EMAIL_IN_USE_PORT) private readonly emailInUsePort: IIsUserEmailInUsePort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        configService: ConfigService,
    ) {
        this.uploadSecret = configService.getOrThrow<string>(ENV.JWT_UPLOAD_SECRET);
    }

    /**
     * Reserves a UUID in the proof without writing an account, job, or audit record.
     *
     * @param command Validated registration form
     * @returns One signed PUT and the proof accepted by registration
     * @throws {ResourceConflictException} When the email is already held by an account
     * @throws {DependencyUnavailableException} When the primary database or storage is unavailable
     * @throws {SystemException} When storage authorization fails or returns an incompatible plan
     */
    async execute(command: InitiateUserRegistrationCommand): Promise<InitiateUserRegistrationResult> {
        if ((await this.emailInUsePort.isEmailInUse(command.email)).isInUse) {
            throw new ResourceConflictException(ResourceConflictMessage.EMAIL_IN_USE);
        }

        const id = uuidv7(),
            now = Math.floor(Date.now() / 1000),
            fileKey = buildUserPendingAvatarKey(id, id),
            plan = await this.storagePort.initiateUpload({
                key: fileKey,
                sizeBytes: command.avatar.sizeBytes,
                contentType: command.avatar.contentType,
                cache: AVATAR_PENDING_CACHE_POLICY,
                deadline: new Date((now + USER_REGISTRATION_UPLOAD_URL_TTL_SECONDS) * 1000),
            });

        if (plan.mode !== 'single') {
            throw new SystemException('Avatar upload requires a single PUT plan.', {
                context: { class: InitiateUserRegistrationCommandHandler.name, method: this.execute.name },
            });
        }

        return {
            mode: plan.mode,
            request: plan.request,
            uploadToken: await this.tokenPort.generateUploadToken({
                sub: id,
                jti: randomUUID(),
                purpose: UserUploadPurpose.REGISTRATION,
                fileKey,
                formHash: createUserRegistrationFormHash(command, this.uploadSecret),
                exp: now + USER_REGISTRATION_UPLOAD_TOKEN_TTL_SECONDS,
            }),
        };
    }
}
