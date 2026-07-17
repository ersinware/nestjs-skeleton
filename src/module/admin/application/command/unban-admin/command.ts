/**
 * @file command.ts
 * @description Defines the command to lift a ban on an administrator account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command payload to unban an admin account by ID.
 */
export class UnbanAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}
