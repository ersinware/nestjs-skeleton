/**
 * @file user-event.enum.ts
 * @description Enumeration for user domain events.
 */

export enum UserEvent {
    CREATED = 'user.created',
    UPDATED = 'user.updated',
    DELETED = 'user.deleted',
    STATUS_CHANGED = 'user.status_changed',
}
