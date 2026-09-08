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
 * Result of the LoginUserCommand: the freshly issued token pair.
 */
export type LoginUserResult = {
    readonly accessToken: string;
    readonly refreshToken: string;
};
