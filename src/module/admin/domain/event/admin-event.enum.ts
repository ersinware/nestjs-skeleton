/**
 * @file admin-event.enum.ts
 * @description Domain-event names emitted by the Admin aggregate.
 */

/**
 * Domain events the Admin aggregate emits, keyed by the on-bus event name.
 */
export enum AdminEvent {
    /** Account soft-deleted; the session version was bumped. */
    DELETED = 'admin.deleted',

    /** Account banned; the session version was bumped. */
    BANNED = 'admin.banned',

    /** Ban lifted; the session version is untouched. */
    UNBANNED = 'admin.unbanned',

    /** Every session revoked after refresh-token reuse; the session version was bumped. */
    SESSIONS_REVOKED = 'admin.sessions_revoked',
}
