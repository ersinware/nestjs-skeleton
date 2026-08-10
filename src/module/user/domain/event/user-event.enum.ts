/**
 * @file user-event.enum.ts
 * @description Domain-event names emitted by the User aggregate.
 */

/**
 * Domain events the User aggregate emits, keyed by the on-bus event name.
 */
export enum UserEvent {
    /** Profile fields (name/email) changed. */
    UPDATED = 'user.updated',

    /** Password changed; the session version was bumped. */
    PASSWORD_CHANGED = 'user.password_changed',

    /** Account banned; the session version was bumped. */
    BANNED = 'user.banned',

    /** Ban lifted; the session version is untouched. */
    UNBANNED = 'user.unbanned',

    /** Account soft-deleted; the session version was bumped. */
    DELETED = 'user.deleted',

    /** Every session revoked after refresh-token reuse; the session version was bumped. */
    SESSIONS_REVOKED = 'user.sessions_revoked',
}
