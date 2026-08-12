/**
 * @file command.ts
 * @description Defines the UpdateAdminCommand for updating an admin's profile details.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to update an admin's basic profile details.
 */
export class UpdateAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
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
