/**
 * @file audit-trail-audit.ts
 * @description Audit actions owned by the audit trail workflows.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Audit actions owned by the audit trail workflows.
 */
export const AuditTrailAuditAction = {
    /**
     * An operator read the audit trail; who inspects the evidence is evidence too.
     */
    AUDIT_TRAIL_ACCESSED: defineAuditAction('AUDIT_TRAIL_ACCESSED'),
} as const;
