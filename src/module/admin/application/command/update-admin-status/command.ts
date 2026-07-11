/**
 * @file command.ts
 * @description Defines the command to activate or deactivate an administrator account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command payload to change the active status of an admin account by ID.
 */
export class UpdateAdminStatusCommand extends Command<void> {
    constructor(
        readonly id: string,
        readonly active: boolean,
    ) {
        super();
    }
}
