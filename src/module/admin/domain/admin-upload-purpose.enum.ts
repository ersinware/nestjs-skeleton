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
}
