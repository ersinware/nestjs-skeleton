/**
 * @file domain-failure-audit-action.enum.ts
 * @description Audit actions for refusals reported by domain rules.
 */

/**
 * Audit actions domain rules attach to refusal exceptions for the handling boundary to record.
 */
export enum DomainFailureAuditAction {
    /**
     * A password change failed current-password verification.
     */
    PASSWORD_CHANGE_FAILED = 'PASSWORD_CHANGE_FAILED',

    /**
     * An email change request failed current-password verification.
     */
    EMAIL_CHANGE_REQUEST_FAILED = 'EMAIL_CHANGE_REQUEST_FAILED',

    /**
     * A verified confirmation proof was used by another principal, or a banned account attempted confirmation.
     */
    EMAIL_CHANGE_CONFIRMATION_FAILED = 'EMAIL_CHANGE_CONFIRMATION_FAILED',

    /**
     * Rejected admin activation; the record carries the reason the client never sees.
     */
    ADMIN_ACTIVATION_FAILED = 'ADMIN_ACTIVATION_FAILED',
}
