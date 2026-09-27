/**
 * @file audit-action.enum.ts
 * @description Audit actions selected by application workflows and technical boundaries.
 */

/**
 * Audit actions selected by application workflows and technical boundaries.
 */
export enum AuditAction {
    /**
     * An authenticated caller was refused by the authorization guard or a domain administration rule — written by the global filter on 403.
     */
    ACCESS_DENIED = 'ACCESS_DENIED',

    /**
     * A read endpoint disclosed another principal's personal data.
     */
    PERSONAL_DATA_ACCESSED = 'PERSONAL_DATA_ACCESSED',

    /**
     * An operator read the audit trail; who inspects the evidence is evidence too.
     */
    AUDIT_TRAIL_ACCESSED = 'AUDIT_TRAIL_ACCESSED',

    /**
     * An operator discarded exact jobs from the shared dead-letter queue.
     */
    JOB_DEAD_LETTER_DISCARDED = 'JOB_DEAD_LETTER_DISCARDED',

    /**
     * An operator durably requested a shared dead-letter redrive operation.
     */
    JOB_DEAD_LETTER_REDRIVE_REQUESTED = 'JOB_DEAD_LETTER_REDRIVE_REQUESTED',

    /**
     * Successful credential login.
     */
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',

    /**
     * Rejected credential login; the record carries the precise reason the client never sees.
     */
    LOGIN_FAILED = 'LOGIN_FAILED',

    /**
     * A request to sign out of every session.
     */
    LOGOUT_ALL = 'LOGOUT_ALL',

    /**
     * Rejected refresh-token replay within grace; concurrency and theft remain indistinguishable.
     */
    REFRESH_CONCURRENT_REPLAY = 'REFRESH_CONCURRENT_REPLAY',

    /**
     * Replay of an already-rotated refresh token — the token-theft signal.
     */
    REFRESH_REUSE_DETECTED = 'REFRESH_REUSE_DETECTED',

    /**
     * Self-service password change; every previously minted token is revoked.
     */
    PASSWORD_CHANGED = 'PASSWORD_CHANGED',

    /**
     * A password-verified email change request and its delivery were committed.
     */
    EMAIL_CHANGE_REQUESTED = 'EMAIL_CHANGE_REQUESTED',

    /**
     * A confirmed email change committed with session revocation and old-address notice.
     */
    EMAIL_CHANGED = 'EMAIL_CHANGED',

    /**
     * A user registered their own account — the birth of the trail's subject; public route, so unattributed.
     */
    USER_REGISTERED = 'USER_REGISTERED',

    /**
     * A pending user's activation delivery request was committed; delivery may follow.
     */
    USER_ACTIVATION_REQUESTED = 'USER_ACTIVATION_REQUESTED',

    /**
     * A pending user account was activated after email and password proof.
     */
    USER_ACTIVATED = 'USER_ACTIVATED',

    /**
     * A change to the user's display name.
     */
    USER_UPDATED = 'USER_UPDATED',

    /**
     * A user account was banned and its sessions revoked.
     */
    USER_BANNED = 'USER_BANNED',

    /**
     * A ban on a user account was lifted.
     */
    USER_UNBANNED = 'USER_UNBANNED',

    /**
     * A user account was soft-deleted.
     */
    USER_DELETED = 'USER_DELETED',

    /**
     * A user's permission set was changed; `detail` names what was granted and revoked.
     */
    USER_PERMISSIONS_CHANGED = 'USER_PERMISSIONS_CHANGED',

    /**
     * An owner consumer committed revocation of a user's sessions.
     */
    USER_SESSIONS_REVOKED = 'USER_SESSIONS_REVOKED',

    /**
     * An admin account was created, pending activation by its owner.
     */
    ADMIN_CREATED = 'ADMIN_CREATED',

    /**
     * A fresh invitation was issued for a pending admin account.
     */
    ADMIN_INVITED = 'ADMIN_INVITED',

    /**
     * A pending admin account was activated by its owner setting the first password.
     */
    ADMIN_ACTIVATED = 'ADMIN_ACTIVATED',

    /**
     * A change to an admin's display name.
     */
    ADMIN_UPDATED = 'ADMIN_UPDATED',

    /**
     * An admin account was banned and its sessions revoked.
     */
    ADMIN_BANNED = 'ADMIN_BANNED',

    /**
     * A ban on an admin account was lifted.
     */
    ADMIN_UNBANNED = 'ADMIN_UNBANNED',

    /**
     * An admin account was soft-deleted.
     */
    ADMIN_DELETED = 'ADMIN_DELETED',

    /**
     * An admin's permission set was changed; `detail` names what was granted and revoked.
     */
    ADMIN_PERMISSIONS_CHANGED = 'ADMIN_PERMISSIONS_CHANGED',

    /**
     * An owner consumer committed revocation of an admin's sessions.
     */
    ADMIN_SESSIONS_REVOKED = 'ADMIN_SESSIONS_REVOKED',
}
