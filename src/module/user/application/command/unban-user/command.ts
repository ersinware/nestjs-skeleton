/**
 * @file command.ts
 * @description Defines the UnbanUserCommand for lifting a ban on a user account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to unban a user account.
 */
export class UnbanUserCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }
}
