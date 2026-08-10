/**
 * @file user-event.enum.ts
 * @description Enumeration for user domain events.
 */

export enum UserEvent {
    UPDATED = 'user.updated',
    PASSWORD_CHANGED = 'user.password_changed',
    BANNED = 'user.banned',
    UNBANNED = 'user.unbanned',
    DELETED = 'user.deleted',
    SESSIONS_REVOKED = 'user.sessions_revoked',
}
