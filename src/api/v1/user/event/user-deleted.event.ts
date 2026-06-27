/**
 * @file user-deleted.event.ts
 * @description Strongly typed event payload for user deletion.
 */

/**
 * Event payload dispatched when a user is deleted.
 */
export class UserDeletedEvent {
    /**
     * Creates a new UserDeletedEvent.
     *
     * @param userId The ID of the deleted user.
     */
    constructor(public readonly userId: string) {}
}
