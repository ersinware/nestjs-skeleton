/**
 * @file principal-audit.ts
 * @description Audit actions shared by principal account workflows.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Audit actions shared by principal account workflows.
 */
export const PrincipalAuditAction = {
    /**
     * A read endpoint disclosed another principal's personal data.
     */
    PERSONAL_DATA_ACCESSED: defineAuditAction('PERSONAL_DATA_ACCESSED'),

    /**
     * Self-service password change; every previously minted token is revoked.
     */
    PASSWORD_CHANGED: defineAuditAction('PASSWORD_CHANGED'),

    /**
     * A password-verified email change request and its delivery were committed.
     */
    EMAIL_CHANGE_REQUESTED: defineAuditAction('EMAIL_CHANGE_REQUESTED'),

    /**
     * A confirmed email change committed with session revocation and old-address notice.
     */
    EMAIL_CHANGED: defineAuditAction('EMAIL_CHANGED'),
} as const;
