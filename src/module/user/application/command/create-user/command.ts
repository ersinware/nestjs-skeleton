/**
 * @file command.ts
 * @description Defines the CreateUserCommand for creating a new user.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to create a new user.
 */
export class CreateUserCommand extends Command<string> {
    /**
     * Initializes the command payload.
     *
     * @param email The email address of the new user
     * @param name The name of the new user
     * @param password The plain-text password for the new user
     */
    constructor(
        readonly email: string,
        readonly name: string,
        readonly password: string,
    ) {
        super();
    }
}
