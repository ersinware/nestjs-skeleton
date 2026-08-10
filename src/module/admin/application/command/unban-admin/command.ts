/**
 * @file command.ts
 * @description Command that lifts the ban on an admin account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Lifts the ban on an admin account.
 */
export class UnbanAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin to unban
     */
    constructor(readonly id: string) {
        super();
    }
}
