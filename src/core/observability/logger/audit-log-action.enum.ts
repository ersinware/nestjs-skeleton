/**
 * @file audit-log-action.enum.ts
 * @description Enumeration of standard audit log actions for security events.
 */

/**
 * Enumeration of standard audit log actions for tracking security events.
 */
export enum AuditLogAction {
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',
    LOGIN_FAILED = 'LOGIN_FAILED',
    REFRESH_FAILED = 'REFRESH_FAILED',
    REFRESH_REUSE_DETECTED = 'REFRESH_REUSE_DETECTED',
    SECURITY_EXCEPTION = 'SECURITY_EXCEPTION',
    OUTBOX_EVENTS_RETRIED = 'OUTBOX_EVENTS_RETRIED',
    OUTBOX_EVENTS_DELETED = 'OUTBOX_EVENTS_DELETED',
    EMAILS_RETRIED = 'EMAILS_RETRIED',
    EMAILS_DELETED = 'EMAILS_DELETED',
}
