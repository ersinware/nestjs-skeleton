/**
 * @file command.ts
 * @description Defines the UpdateUserStatusCommand for changing a user's active status.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to update a user's active status.
 */
export class UpdateUserStatusCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param active The new active status
     */
    constructor(
        readonly id: string,
        readonly active: boolean,
    ) {
        super();
    }
}
