/**
 * @file command.ts
 * @description Defines the command to authenticate an administrator and generate session tokens.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to log in an admin using email and password.
 */
export class LoginAdminCommand extends Command<LoginAdminResult> {
    /**
     * Initializes the command payload.
     *
     * @param email The admin's email address
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
 * Result of the LoginAdminCommand: the freshly issued token pair.
 */
export type LoginAdminResult = {
    accessToken: string;
    refreshToken: string;
};
