/**
 * @file audit-log-auth-reason.enum.ts
 * @description Enum defining the reasons for failed authentication attempts in audit logs.
 */

/**
 * Enum defining the reasons for failed authentication attempts in audit logs.
 */
export enum AuditLogAuthReason {
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    INACTIVE_ACCOUNT = 'ACCOUNT_IS_INACTIVE',
    INVALID_PASSWORD = 'INVALID_PASSWORD',
}
