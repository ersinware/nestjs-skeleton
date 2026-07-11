/**
 * @file command.ts
 * @description Defines the command to refresh an existing authentication session using a valid refresh token.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to refresh access and refresh tokens.
 */
export class RefreshTokensCommand extends Command<RefreshTokensResult> {
    constructor(readonly refreshToken: string) {
        super();
    }
}

/**
 * The expected result of the RefreshTokenCommand, containing the new token pair.
 */
export type RefreshTokensResult = {
    accessToken: string;
    refreshToken: string;
};
