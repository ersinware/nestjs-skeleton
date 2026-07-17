/**
 * @file command.ts
 * @description Defines the command to ban an administrator account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command payload to ban an admin account by ID.
 */
export class BanAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}
