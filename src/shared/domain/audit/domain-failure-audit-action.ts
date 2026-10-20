/**
 * @file domain-failure-audit-action.ts
 * @description Audit actions for refusals reported by domain rules.
 */

import { defineAuditAction } from 'src/shared/domain/audit/audit-action';

/**
 * Audit actions domain rules attach to refusal exceptions for the handling boundary to record.
 */
export const DomainFailureAuditAction = {
    /**
     * A password change was refused for a banned account or an incorrect current password.
     */
    PASSWORD_CHANGE_FAILED: defineAuditAction('PASSWORD_CHANGE_FAILED'),

    /**
     * An email change request was refused for a banned account or an incorrect current password.
     */
    EMAIL_CHANGE_REQUEST_FAILED: defineAuditAction('EMAIL_CHANGE_REQUEST_FAILED'),

    /**
     * A verified confirmation proof was used by another principal, or a banned account attempted confirmation.
     */
    EMAIL_CHANGE_CONFIRMATION_FAILED: defineAuditAction('EMAIL_CHANGE_CONFIRMATION_FAILED'),
} as const;
