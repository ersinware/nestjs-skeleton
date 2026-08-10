/**
 * @file command.ts
 * @description Command that soft-deletes an admin account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Soft-deletes an admin account.
 */
export class DeleteAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin to delete
     */
    constructor(readonly id: string) {
        super();
    }
}
