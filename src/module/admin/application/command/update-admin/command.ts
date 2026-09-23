/**
 * @file command.ts
 * @description Defines the UpdateAdminCommand for updating an admin's display name.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to update an admin's display name.
 */
export class UpdateAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
     * @param name The new display name
     */
    constructor(
        readonly id: string,
        readonly name: string,
    ) {
        super();
    }
}
