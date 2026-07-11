/**
 * @file command.ts
 * @description Defines the command and result type for creating a new administrator account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command payload to create a new administrator.
 */
export class CreateAdminCommand extends Command<CreateAdminResult> {
    constructor(
        readonly email: string,
        readonly name: string,
    ) {
        super();
    }
}

/**
 * The expected result of the CreateAdminCommand, returning the unique identifier of the newly created admin.
 */
export type CreateAdminResult = string;
