/**
 * @file auth-audit.ts
 * @description Audit actions owned by the authentication workflows.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Audit actions owned by the authentication workflows.
 */
export const AuthAuditAction = {
    /**
     * Successful credential login.
     */
    LOGIN_SUCCESS: defineAuditAction('LOGIN_SUCCESS'),

    /**
     * Rejected credential login; the record carries the precise reason the client never sees.
     */
    LOGIN_FAILED: defineAuditAction('LOGIN_FAILED'),

    /**
     * A request to sign out of every session.
     */
    LOGOUT_ALL: defineAuditAction('LOGOUT_ALL'),

    /**
     * Rejected refresh-token replay within grace; concurrency and theft remain indistinguishable.
     */
    REFRESH_CONCURRENT_REPLAY: defineAuditAction('REFRESH_CONCURRENT_REPLAY'),

    /**
     * Replay of an already-rotated refresh token — the token-theft signal.
     */
    REFRESH_REUSE_DETECTED: defineAuditAction('REFRESH_REUSE_DETECTED'),
} as const;
