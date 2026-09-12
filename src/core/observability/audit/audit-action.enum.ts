/**
 * @file audit-action.enum.ts
 * @description Closed vocabulary of the events this system considers audit-worthy.
 */

/**
 * Every action an audit entry may record. Deliberately CLOSED: nothing structurally forces a new
 * command to record anything, so this single reviewable list is the mitigation.
 */
export enum AuditAction {
    /** Successful credential login. */
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',

    /** Rejected credential login; the record carries the precise reason the client never sees. */
    LOGIN_FAILED = 'LOGIN_FAILED',

    /** Sign-out of a single session. */
    LOGOUT = 'LOGOUT',

    /** Sign-out of every session at once — kept distinct from {@link LOGOUT} in the trail. */
    LOGOUT_ALL = 'LOGOUT_ALL',

    /** Rejected refresh-token replay within grace; concurrency and theft remain indistinguishable. */
    REFRESH_CONCURRENT_REPLAY = 'REFRESH_CONCURRENT_REPLAY',

    /** Replay of an already-rotated refresh token — the token-theft signal. */
    REFRESH_REUSE_DETECTED = 'REFRESH_REUSE_DETECTED',

    /** Self-service password change; every previously minted token is revoked. */
    PASSWORD_CHANGED = 'PASSWORD_CHANGED',

    /** An authenticated caller was refused by the authorization guard or a domain administration rule — written by the global filter on 403. */
    ACCESS_DENIED = 'ACCESS_DENIED',

    /** A user registered their own account — the birth of the trail's subject; public route, so unattributed. */
    USER_REGISTERED = 'USER_REGISTERED',

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

    /** A user's permission set was changed; `detail` names what was granted and revoked. */
    USER_PERMISSIONS_CHANGED = 'USER_PERMISSIONS_CHANGED',

    // Privileged actions on admins — kept apart so the trail names the subject's kind.
    /** An admin account was created, pending activation by its owner. */
    ADMIN_CREATED = 'ADMIN_CREATED',

    /** A fresh invitation was issued for a pending admin account. */
    ADMIN_INVITED = 'ADMIN_INVITED',

    /** A pending admin account was activated by its owner setting the first password. */
    ADMIN_ACTIVATED = 'ADMIN_ACTIVATED',

    /** Rejected admin activation; the record carries the reason the client never sees. */
    ADMIN_ACTIVATION_FAILED = 'ADMIN_ACTIVATION_FAILED',

    /** A change to an admin's profile identity, chiefly the email — an account-takeover vector even when self-service. */
    ADMIN_UPDATED = 'ADMIN_UPDATED',

    /** An admin account was banned and its sessions revoked. */
    ADMIN_BANNED = 'ADMIN_BANNED',

    /** A ban on an admin account was lifted. */
    ADMIN_UNBANNED = 'ADMIN_UNBANNED',

    /** An admin account was soft-deleted. */
    ADMIN_DELETED = 'ADMIN_DELETED',

    /** Every session of an admin was revoked after refresh-token reuse. */
    ADMIN_SESSIONS_REVOKED = 'ADMIN_SESSIONS_REVOKED',

    /** An admin's permission set was changed; `detail` names what was granted and revoked. */
    ADMIN_PERMISSIONS_CHANGED = 'ADMIN_PERMISSIONS_CHANGED',

    /** A read endpoint disclosed another principal's personal data. */
    PERSONAL_DATA_ACCESSED = 'PERSONAL_DATA_ACCESSED',

    /** An operator read the audit trail; who inspects the evidence is evidence too. */
    AUDIT_TRAIL_ACCESSED = 'AUDIT_TRAIL_ACCESSED',
}
