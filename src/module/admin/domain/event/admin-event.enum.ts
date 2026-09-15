/**
 * @file admin-event.enum.ts
 * @description Domain-event names emitted by the Admin aggregate.
 */

/**
 * Domain events the Admin aggregate emits, keyed by the on-bus event name.
 */
export enum AdminEvent {
    /** Account created pending activation; an invitation email is owed to the owner. */
    INVITED = 'admin.invited.v1',

    /** Password changed; the session version was bumped. */
    PASSWORD_CHANGED = 'admin.password_changed.v1',

    /** Account soft-deleted; the session version was bumped. */
    DELETED = 'admin.deleted.v1',

    /** Account banned; the session version was bumped. */
    BANNED = 'admin.banned.v1',

    /** Every session revoked after refresh-token reuse; the session version was bumped. */
    SESSIONS_REVOKED = 'admin.sessions_revoked.v1',

    /** Permission set changed; the session version was bumped so the old token's claims die with it. */
    PERMISSIONS_CHANGED = 'admin.permissions_changed.v1',
}
