/**
 * @file command.ts
 * @description Command that bans an admin account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Bans an admin account.
 */
export class BanAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin to ban
     */
    constructor(readonly id: string) {
        super();
    }
}
