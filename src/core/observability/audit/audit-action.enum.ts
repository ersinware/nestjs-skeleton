/**
 * @file audit-action.enum.ts
 * @description Closed vocabulary of the events this system considers audit-worthy.
 */

/**
 * Every action an audit entry may record. Deliberately CLOSED: nothing structurally forces a new
 * command to record anything, so this single reviewable list is the mitigation.
 */
export enum AuditAction {
    // Authentication
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',
    LOGIN_FAILED = 'LOGIN_FAILED',
    /** Sign-out of a single session. */
    LOGOUT = 'LOGOUT',
    /** Sign-out of every session at once — kept distinct from {@link LOGOUT} in the trail. */
    LOGOUT_ALL = 'LOGOUT_ALL',
    /** Replay of an already-rotated refresh token — the token-theft signal. */
    REFRESH_REUSE_DETECTED = 'REFRESH_REUSE_DETECTED',
    PASSWORD_CHANGED = 'PASSWORD_CHANGED',

    // Authorization refusals — recorded by the exception filter.
    ACCESS_DENIED = 'ACCESS_DENIED',

    // Privileged actions on users
    /** A change to profile identity, chiefly the email — an account-takeover vector even when self-service. */
    USER_UPDATED = 'USER_UPDATED',
    USER_BANNED = 'USER_BANNED',
    USER_UNBANNED = 'USER_UNBANNED',
    USER_DELETED = 'USER_DELETED',
    USER_SESSIONS_REVOKED = 'USER_SESSIONS_REVOKED',

    // Privileged actions on admins — kept apart so the trail names the subject's kind.
    ADMIN_BANNED = 'ADMIN_BANNED',
    ADMIN_UNBANNED = 'ADMIN_UNBANNED',
    ADMIN_DELETED = 'ADMIN_DELETED',
    ADMIN_SESSIONS_REVOKED = 'ADMIN_SESSIONS_REVOKED',

    // Personal-data disclosure — written by the interceptor on `@Audited` reads.
    PERSONAL_DATA_ACCESSED = 'PERSONAL_DATA_ACCESSED',
}
