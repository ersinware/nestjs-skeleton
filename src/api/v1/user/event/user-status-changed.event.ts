/**
 * @file user-status-changed.event.ts
 * @description Strongly typed event payload for user status changes.
 */

/**
 * Event payload dispatched when a user's active status changes.
 */
export class UserStatusChangedEvent {
    /**
     * Creates a new UserStatusChangedEvent.
     *
     * @param userId The ID of the updated user.
     * @param isActive The new active status of the user.
     */
    constructor(
        public readonly userId: string,
        public readonly isActive: boolean,
    ) {}
}
