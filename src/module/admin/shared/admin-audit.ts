/**
 * @file admin-audit.ts
 * @description Shared refusal audit actions owned by the admin account workflows.
 */

/**
 * Audit actions owned by the admin account workflows.
 */
export enum AdminFailureAuditAction {
    /**
     * Rejected admin activation; the record carries the reason the client never sees.
     */
    ADMIN_ACTIVATION_FAILED = 'ADMIN_ACTIVATION_FAILED',

    /**
     * A banned admin attempted to prepare a profile avatar change.
     */
    ADMIN_AVATAR_CHANGE_FAILED = 'ADMIN_AVATAR_CHANGE_FAILED',

    /**
     * A profile update was refused for a banned admin or a proof ownership mismatch.
     */
    ADMIN_UPDATE_FAILED = 'ADMIN_UPDATE_FAILED',

    /**
     * A banned admin could not receive a replacement invitation.
     */
    ADMIN_INVITATION_FAILED = 'ADMIN_INVITATION_FAILED',

    /**
     * An administrative mutation was refused by admin hierarchy or self-target restrictions.
     */
    ADMIN_ADMINISTRATION_DENIED = 'ADMIN_ADMINISTRATION_DENIED',
}
