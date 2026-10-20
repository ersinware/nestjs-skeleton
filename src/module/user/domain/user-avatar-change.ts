/**
 * @file user-avatar-change.ts
 * @description Owns profile avatar upload lifetimes and form binding to upload proofs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';
import { InvalidInputException } from 'src/shared/exception';

/**
 * Time allowed to upload a profile avatar, in seconds.
 */
export const USER_AVATAR_CHANGE_UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Time allowed to accept the uploaded profile avatar, in seconds.
 */
export const USER_AVATAR_CHANGE_UPLOAD_TOKEN_TTL_SECONDS = 600;

/**
 * Normalized profile fields and identities bound to one upload proof.
 */
type UserAvatarChangeForm = {
    /**
     * Account identified by the verified principal.
     */
    readonly id: string;

    /**
     * Immutable avatar identity shared with the replacement delivery.
     */
    readonly avatarId: string;

    /**
     * Normalized replacement name, present only for a combined profile update.
     */
    readonly name?: string;

    /**
     * Exact declared size and media type of the replacement avatar.
     */
    readonly avatar: AvatarUploadDescriptor;
};

/**
 * Binds one profile form to its owner and avatar identity.
 *
 * @param form Validated and normalized profile form
 * @param uploadSecret Server-held upload secret
 * @returns Opaque keyed form binding
 */
export function createUserAvatarChangeFormHash(form: UserAvatarChangeForm, uploadSecret: string): string {
    return createHmac('sha256', uploadSecret)
        .update(
            JSON.stringify([
                UserUploadPurpose.PROFILE_AVATAR,
                form.id,
                form.avatarId,
                form.name,
                form.avatar.sizeBytes,
                form.avatar.contentType,
            ]),
        )
        .digest('hex');
}

/**
 * Rejects a final form that differs from the signature-verified binding.
 *
 * @param form Validated and normalized final profile form
 * @param secret Server-held upload secret
 * @param expectedFormHash Binding from the verified upload proof
 * @throws {InvalidInputException} When the form binding does not match
 */
export function assertUserAvatarChangeFormHashMatches(
    form: UserAvatarChangeForm,
    secret: string,
    expectedFormHash: string,
) {
    const actualFormHashBuffer = Buffer.from(createUserAvatarChangeFormHash(form, secret)),
        expectedFormHashBuffer = Buffer.from(expectedFormHash);

    if (
        actualFormHashBuffer.length !== expectedFormHashBuffer.length ||
        !timingSafeEqual(actualFormHashBuffer, expectedFormHashBuffer)
    ) {
        throw new InvalidInputException();
    }
}
