/**
 * @file admin-upload-purpose.enum.ts
 * @description Upload proof purposes owned by the admin context.
 */

/**
 * Separates admin upload proofs from other account workflows.
 */
export enum AdminUploadPurpose {
    /**
     * Avatar uploaded while completing an invitation.
     */
    ACTIVATION = 'admin_activation',

    /**
     * Avatar selected by an activated admin for their own profile.
     */
    PROFILE_AVATAR = 'admin_profile_avatar',
}
