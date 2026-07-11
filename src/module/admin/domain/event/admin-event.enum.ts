/**
 * @file admin-event.enum.ts
 * @description Enumeration for admin domain events.
 */

/**
 * Enumeration of domain events related to the Admin aggregate.
 */
export enum AdminEvent {
    CREATED = 'admin.created',
    DELETED = 'admin.deleted',
    BANNED = 'admin.banned',
    UNBANNED = 'admin.unbanned',
}
