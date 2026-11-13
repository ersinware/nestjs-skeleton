/**
 * @file handler.ts
 * @description Prepares one form-bound user avatar upload without persisting account state.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import type { ITokenPort } from 'src/core/security/token';
import {
    TOKEN_STORAGE_PORT,
    TOKEN_UPLOAD_TOKEN_PORT,
    type IStoragePort,
    type UploadTokenPayload,
} from 'src/core/storage';
import {
    InitiateUserRegistrationCommand,
    type InitiateUserRegistrationResult,
} from 'src/module/user/application/command/initiate-user-registration/command';
import {
    TOKEN_IS_USER_EMAIL_IN_USE_PORT,
    type IIsUserEmailInUsePort,
} from 'src/module/user/application/query/is-user-email-in-use/port';
import { UserUploadTokenType } from 'src/module/user/application/user-upload-token';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import {
    USER_REGISTRATION_UPLOAD_TOKEN_TTL_SECONDS,
    USER_REGISTRATION_UPLOAD_URL_TTL_SECONDS,
    canonicalizeUserRegistrationForm,
} from 'src/module/user/domain/user-registration';
import { AVATAR_PENDING_CACHE_POLICY } from 'src/shared/domain/avatar';
import { ResourceConflictException, ResourceConflictMessage, SystemException } from 'src/shared/exception';
import { nowEpochSeconds } from 'src/shared/time';
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
     * Initializes upload authorization dependencies.
     *
     * @param emailInUsePort Reads address availability on the primary
     * @param storagePort Signs the conditional upload request
     * @param tokenPort Signs workflow-owned upload claims
     * @param hashingPort Produces and verifies workflow form bindings
     */
    constructor(
        @Inject(TOKEN_IS_USER_EMAIL_IN_USE_PORT) private readonly emailInUsePort: IIsUserEmailInUsePort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        @Inject(TOKEN_UPLOAD_TOKEN_PORT)
        private readonly uploadTokenPort: ITokenPort<typeof UserUploadTokenType.REGISTRATION>,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
    ) {}

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
            now = nowEpochSeconds(),
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
                context: { class: this.constructor.name, method: this.execute.name },
            });
        }

        return {
            mode: plan.mode,
            request: plan.request,
            uploadToken: await this.uploadTokenPort.sign<UploadTokenPayload<UserUploadTokenType.REGISTRATION>>(
                UserUploadTokenType.REGISTRATION,
                {
                    sub: id,
                    jti: randomUUID(),
                    fileKey,
                    formHash: this.hashingPort.hmacSha256(
                        UserUploadTokenType.REGISTRATION,
                        canonicalizeUserRegistrationForm({
                            email: command.email,
                            name: command.name,
                            password: command.password,
                            avatar: command.avatar,
                        }),
                    ),
                    exp: now + USER_REGISTRATION_UPLOAD_TOKEN_TTL_SECONDS,
                },
            ),
        };
    }
}
