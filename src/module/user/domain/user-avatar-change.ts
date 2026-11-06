/**
 * @file user-avatar-change.ts
 * @description Owns profile avatar upload lifetimes and form binding to upload proofs.
 */

import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

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
 * Serializes the profile form in a fixed field order for application-owned HMAC binding.
 *
 * @param form Validated and normalized profile form
 * @returns Canonical form text to pass directly to the hashing port; never expose it in proofs
 */
export function canonicalizeUserAvatarChangeForm(form: UserAvatarChangeForm): string {
    return JSON.stringify([form.id, form.avatarId, form.name, form.avatar.sizeBytes, form.avatar.contentType]);
}
