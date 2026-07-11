/**
 * @file command.ts
 * @description Defines the DeleteUserCommand for soft deleting a user.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to softly delete an existing user.
 */
export class DeleteUserCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user to delete
     */
    constructor(readonly id: string) {
        super();
    }
}
