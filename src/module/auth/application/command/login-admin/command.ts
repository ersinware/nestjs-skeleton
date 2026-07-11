/**
 * @file command.ts
 * @description Defines the command to authenticate an administrator and generate session tokens.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to log in an admin using email and password.
 */
export class LoginAdminCommand extends Command<LoginAdminResult> {
    constructor(
        readonly email: string,
        readonly password: string,
    ) {
        super();
    }
}

/**
 * The expected result of the LoginAdminCommand, containing the generated token pair.
 */
export type LoginAdminResult = {
    accessToken: string;
    refreshToken: string;
};
