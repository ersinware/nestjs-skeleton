/**
 * @file admin-created.event.ts
 * @description Strongly typed event payload for admin creation.
 */

import type { Admin } from '../type/admin.type';

/**
 * Event payload dispatched when a new admin is created.
 */
export class AdminCreatedEvent {
    /**
     * Creates a new AdminCreatedEvent.
     *
     * @param admin The newly created admin entity.
     * @param plainTextPassword The generated plain text password for the admin.
     */
    constructor(
        public readonly admin: Admin,
        public readonly plainTextPassword: string,
    ) {}
}
