/**
 * @file admin-event.enum.ts
 * @description Domain-event names emitted by the Admin aggregate.
 */

/**
 * Domain events the Admin aggregate emits, keyed by the on-bus event name.
 */
export enum AdminEvent {
    DELETED = 'admin.deleted',
    BANNED = 'admin.banned',
    UNBANNED = 'admin.unbanned',
    SESSIONS_REVOKED = 'admin.sessions_revoked',
}
