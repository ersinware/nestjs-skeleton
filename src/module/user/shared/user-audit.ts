/**
 * @file user-audit.ts
 * @description Shared refusal audit actions owned by the user account workflows.
 */

/**
 * Audit actions owned by the user account workflows.
 */
export enum UserFailureAuditAction {
    /**
     * Rejected user activation; the record carries the reason the client never sees.
     */
    USER_ACTIVATION_FAILED = 'USER_ACTIVATION_FAILED',

    /**
     * A banned user requested another activation email without revealing the refusal publicly.
     */
    USER_ACTIVATION_RESEND_FAILED = 'USER_ACTIVATION_RESEND_FAILED',

    /**
     * A profile update was refused for a banned user or a proof ownership mismatch.
     */
    USER_UPDATE_FAILED = 'USER_UPDATE_FAILED',

    /**
     * A banned user attempted to prepare a profile avatar upload.
     */
    USER_AVATAR_CHANGE_FAILED = 'USER_AVATAR_CHANGE_FAILED',
}
