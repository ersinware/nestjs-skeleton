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
    /** Successful credential login. */
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',

    /** Rejected credential login; the record carries the precise reason the client never sees. */
    LOGIN_FAILED = 'LOGIN_FAILED',

    /** Sign-out of a single session. */
    LOGOUT = 'LOGOUT',

    /** Sign-out of every session at once — kept distinct from {@link LOGOUT} in the trail. */
    LOGOUT_ALL = 'LOGOUT_ALL',

    /** Replay of an already-rotated refresh token — the token-theft signal. */
    REFRESH_REUSE_DETECTED = 'REFRESH_REUSE_DETECTED',

    /** Self-service password change; every previously minted token is revoked. */
    PASSWORD_CHANGED = 'PASSWORD_CHANGED',

    // Authorization refusals — recorded by the exception filter.
    /** An authenticated caller was refused by the roles guard — written by the global filter on 403. */
    ACCESS_DENIED = 'ACCESS_DENIED',

    // Privileged actions on users
    /** A change to profile identity, chiefly the email — an account-takeover vector even when self-service. */
    USER_UPDATED = 'USER_UPDATED',

    /** A user account was banned and its sessions revoked. */
    USER_BANNED = 'USER_BANNED',

    /** A ban on a user account was lifted. */
    USER_UNBANNED = 'USER_UNBANNED',

    /** A user account was soft-deleted. */
    USER_DELETED = 'USER_DELETED',

    /** Every session of a user was revoked after refresh-token reuse. */
    USER_SESSIONS_REVOKED = 'USER_SESSIONS_REVOKED',

    // Privileged actions on admins — kept apart so the trail names the subject's kind.
    /** An admin account was banned and its sessions revoked. */
    ADMIN_BANNED = 'ADMIN_BANNED',

    /** A ban on an admin account was lifted. */
    ADMIN_UNBANNED = 'ADMIN_UNBANNED',

    /** An admin account was soft-deleted. */
    ADMIN_DELETED = 'ADMIN_DELETED',

    /** Every session of an admin was revoked after refresh-token reuse. */
    ADMIN_SESSIONS_REVOKED = 'ADMIN_SESSIONS_REVOKED',

    // Personal-data disclosure — written by the interceptor on `@Audited` reads.
    /** A read endpoint disclosed another principal's personal data. */
    PERSONAL_DATA_ACCESSED = 'PERSONAL_DATA_ACCESSED',
}
