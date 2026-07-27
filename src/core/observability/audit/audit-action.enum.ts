/**
 * @file audit-action.enum.ts
 * @description Closed vocabulary of the events this system considers audit-worthy.
 */

/**
 * Every action an audit entry may record.
 *
 * The list is deliberately CLOSED and lives in exactly one place. Writing the audit record is the
 * responsibility of whichever code establishes the fact — a command handler, the exception filter,
 * or an interceptor on a disclosure endpoint — so nothing structurally forces a new command to
 * record anything. This enum is the mitigation: the set of facts worth auditing is reviewable as a
 * single list rather than discovered by grepping call sites.
 *
 * Its scope is the intersection of GDPR art. 5(2)/33, KVKK art. 12, ISO 27001 A.8.15 and SOC 2 CC7.
 * A "who changed the audit configuration" category is absent because nothing about auditing is
 * configurable yet; it is added the day a retention policy is.
 */
export enum AuditAction {
    // 1. Authentication — success and failure are kept symmetric so a ratio can be alarmed on.
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',
    LOGIN_FAILED = 'LOGIN_FAILED',
    /** Sign-out of a single session — the device that presented the refresh token. */
    LOGOUT = 'LOGOUT',
    /** Sign-out of every session at once, kept distinct from {@link LOGOUT} so the trail can tell a single-device sign-out from a full account-wide revocation. */
    LOGOUT_ALL = 'LOGOUT_ALL',
    /** Replay of an already-rotated refresh token — the token-theft signal of RFC 9700. */
    REFRESH_REUSE_DETECTED = 'REFRESH_REUSE_DETECTED',
    PASSWORD_CHANGED = 'PASSWORD_CHANGED',

    // 2. Authorization refusals — the transport's own truth, recorded by the exception filter.
    ACCESS_DENIED = 'ACCESS_DENIED',

    // 3. Privileged actions — always recorded together with their actor.
    /** A change to profile identity, chiefly the email — the login handle, so its change is an account-takeover vector worth an entry even when self-service. */
    USER_UPDATED = 'USER_UPDATED',
    USER_BANNED = 'USER_BANNED',
    USER_UNBANNED = 'USER_UNBANNED',
    USER_DELETED = 'USER_DELETED',
    USER_SESSIONS_REVOKED = 'USER_SESSIONS_REVOKED',
    ADMIN_BANNED = 'ADMIN_BANNED',
    ADMIN_UNBANNED = 'ADMIN_UNBANNED',
    ADMIN_DELETED = 'ADMIN_DELETED',
    ADMIN_SESSIONS_REVOKED = 'ADMIN_SESSIONS_REVOKED',

    // 4. Personal-data access (GDPR art. 15 & art. 17).
    PERSONAL_DATA_EXPORTED = 'PERSONAL_DATA_EXPORTED',
    PERSONAL_DATA_ERASED = 'PERSONAL_DATA_ERASED',
}
