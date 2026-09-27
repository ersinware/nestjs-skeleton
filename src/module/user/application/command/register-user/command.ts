/**
 * @file command.ts
 * @description Defines the RegisterUserCommand for self-service user registration.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to register a pending user account on their own behalf.
 */
export class RegisterUserCommand extends Command<void> {
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
