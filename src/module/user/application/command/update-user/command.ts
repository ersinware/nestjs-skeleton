/**
 * @file command.ts
 * @description Defines the UpdateUserCommand for updating a user's profile details.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to update a user's basic profile details.
 */
export class UpdateUserCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param email The new email address (optional)
     * @param name The new name (optional)
     */
    constructor(
        readonly id: string,
        readonly email?: string,
        readonly name?: string,
    ) {
        super();
    }
}
