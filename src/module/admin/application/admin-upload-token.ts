/**
 * @file admin-upload-token.ts
 * @description Token type discriminators distinguishing admin avatar upload workflows.
 */

import type { UploadTokenPayload } from 'src/core/storage';

/**
 * Admin upload token `type` discriminators; used directly on signed upload tokens and form bindings.
 */
export enum AdminUploadTokenType {
    /**
     * Avatar upload proof minted while activating an invited administrator.
     */
    ACTIVATION = 'admin-activation-avatar',

    /**
     * Avatar upload proof minted for an authenticated administrator profile update.
     */
    PROFILE_AVATAR = 'admin-profile-avatar',
}

/**
 * Profile avatar proof bound to the account revocation state at issuance.
 */
export type AdminProfileAvatarTokenPayload = UploadTokenPayload<AdminUploadTokenType.PROFILE_AVATAR> & {
    /**
     * Signed account revocation snapshot checked against current state by the aggregate.
     */
    readonly revocationVersion: number;
};
