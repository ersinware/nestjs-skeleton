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
    REPLAY_ATTACK = 'REPLAY_ATTACK',
    SECURITY_EXCEPTION = 'SECURITY_EXCEPTION',
}
