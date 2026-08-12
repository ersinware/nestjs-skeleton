/**
 * @file admin-event.enum.ts
 * @description Domain-event names emitted by the Admin aggregate.
 */

/**
 * Domain events the Admin aggregate emits, keyed by the on-bus event name.
 */
export enum AdminEvent {
    /** Account created pending activation; an invitation email is owed to the owner. */
    INVITED = 'admin.invited',

    /** Profile fields changed. */
    UPDATED = 'admin.updated',

    /** Password changed; the session version was bumped. */
    PASSWORD_CHANGED = 'admin.password_changed',

    /** Account soft-deleted; the session version was bumped. */
    DELETED = 'admin.deleted',

    /** Account banned; the session version was bumped. */
    BANNED = 'admin.banned',

    /** Ban lifted; the session version is untouched. */
    UNBANNED = 'admin.unbanned',

    /** Every session revoked after refresh-token reuse; the session version was bumped. */
    SESSIONS_REVOKED = 'admin.sessions_revoked',
}
