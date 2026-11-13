/**
 * @file user-upload-token.ts
 * @description Token type discriminators distinguishing user avatar upload workflows.
 */

import type { UploadTokenPayload } from 'src/core/storage';

/**
 * User upload token `type` discriminators; used directly on signed upload tokens and form bindings.
 */
export enum UserUploadTokenType {
    /**
     * Avatar upload proof minted while initiating self-service user registration.
     */
    REGISTRATION = 'user-registration-avatar',

    /**
     * Avatar upload proof minted for an authenticated user profile update.
     */
    PROFILE_AVATAR = 'user-profile-avatar',
}

/**
 * Profile avatar proof bound to the account revocation state at issuance.
 */
export type UserProfileAvatarTokenPayload = UploadTokenPayload<UserUploadTokenType.PROFILE_AVATAR> & {
    /**
     * Signed account revocation snapshot checked against current state by the aggregate.
     */
    readonly revocationVersion: number;
};
