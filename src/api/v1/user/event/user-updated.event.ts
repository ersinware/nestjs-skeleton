/**
 * @file user-updated.event.ts
 * @description Strongly typed event payload for user updates.
 */

/**
 * Event payload dispatched when a user is updated.
 */
export class UserUpdatedEvent {
    /**
     * Creates a new UserUpdatedEvent.
     *
     * @param userId The ID of the updated user.
     */
    constructor(public readonly userId: string) {}
}
