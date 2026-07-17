/**
 * @file command.ts
 * @description Defines the BanUserCommand for banning a user account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to ban a user account.
 */
export class BanUserCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }
}
