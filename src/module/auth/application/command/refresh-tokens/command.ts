/**
 * @file command.ts
 * @description Defines the command to refresh an existing authentication session using a valid refresh token, together with the use case's client-safe rejection vocabulary.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Enum defining the client-safe messages of refresh rejections. Lives with the command because the
 * vocabulary belongs to this use case, not to the shared exception taxonomy.
 */
export enum RefreshTokensMessage {
    /**
     * The credential was consumed within grace. Timing does not prove legitimacy; clients without
     * the winning token pair must authenticate again instead of retrying the consumed credential.
     */
    CONCURRENT_REFRESH = 'A newer session already exists; retry with the latest token.',
}

/**
 * Command to refresh access and refresh tokens.
 */
export class RefreshTokensCommand extends Command<RefreshTokensResult> {
    /**
     * Initializes the command payload.
     *
     * @param refreshToken The refresh token being rotated away
     */
    constructor(readonly refreshToken: string) {
        super();
    }
}

/**
 * Result of the RefreshTokensCommand: the freshly issued token pair.
 */
export type RefreshTokensResult = {
    readonly accessToken: string;
    readonly refreshToken: string;
};
