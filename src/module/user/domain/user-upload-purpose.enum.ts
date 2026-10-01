/**
 * @file user-upload-purpose.enum.ts
 * @description Defines upload proof purposes owned by the User bounded context.
 */

/**
 * User-owned purposes accepted by upload proofs.
 */
export enum UserUploadPurpose {
    /**
     * Initial avatar upload for a pending user account.
     */
    REGISTRATION = 'user_signup',
}
