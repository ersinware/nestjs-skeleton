/**
 * @file command.ts
 * @description Defines the command to authenticate a regular user and generate session tokens.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to log in a user using email and password.
 */
export class LoginUserCommand extends Command<LoginUserResult> {
    /**
     * Initializes the command payload.
     *
     * @param email The user's email address
     * @param password The plain-text password to verify
     */
    constructor(
        readonly email: string,
        readonly password: string,
    ) {
        super();
    }
}

/**
 * The expected result of the LoginUserCommand, containing the generated token pair.
 */
export type LoginUserResult = {
    accessToken: string;
    refreshToken: string;
};
