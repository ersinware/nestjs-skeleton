/**
 * @file command.ts
 * @description Defines the command to revoke the session bound to a refresh token.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to revoke the single session a refresh token is bound to.
 */
export class LogoutCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param refreshToken The refresh token identifying the session to revoke
     */
    constructor(readonly refreshToken: string) {
        super();
    }
}
