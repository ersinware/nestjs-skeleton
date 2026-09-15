/**
 * @file user-event.enum.ts
 * @description Domain-event names emitted by the User aggregate.
 */

/**
 * Domain events the User aggregate emits, keyed by the on-bus event name.
 */
export enum UserEvent {
    /** Profile fields (name/email) changed. */
    UPDATED = 'user.updated.v1',

    /** Password changed; the session version was bumped. */
    PASSWORD_CHANGED = 'user.password_changed.v1',

    /** Account banned; the session version was bumped. */
    BANNED = 'user.banned.v1',

    /** Ban lifted; the session version is untouched. */
    UNBANNED = 'user.unbanned.v1',

    /** Account soft-deleted; the session version was bumped. */
    DELETED = 'user.deleted.v1',

    /** Every session revoked after refresh-token reuse; the session version was bumped. */
    SESSIONS_REVOKED = 'user.sessions_revoked.v1',

    /** Permission set changed; the session version was bumped so the old token's claims die with it. */
    PERMISSIONS_CHANGED = 'user.permissions_changed.v1',
}
