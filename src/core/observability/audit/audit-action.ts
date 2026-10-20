/**
 * @file audit-action.ts
 * @description Technical audit actions produced by core boundaries.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Technical audit actions produced by core boundaries.
 */
export const AuditAction = {
    /**
     * An authenticated caller was refused by the authorization guard or a domain administration rule — written by the global filter on 403.
     */
    ACCESS_DENIED: defineAuditAction('ACCESS_DENIED'),
} as const;
