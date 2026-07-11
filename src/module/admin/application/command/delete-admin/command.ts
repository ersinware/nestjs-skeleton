/**
 * @file command.ts
 * @description Defines the command to soft-delete an administrator account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command payload to initiate the deletion of an admin account by ID.
 */
export class DeleteAdminCommand extends Command<void> {
    constructor(readonly id: string) {
        super();
    }
}
