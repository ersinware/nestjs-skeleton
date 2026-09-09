/**
 * @file command.ts
 * @description Defines the command to revoke the session bound to a refresh token.
 */

import { Command } from '@nestjs/cqrs';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Command to revoke the single session a refresh token is bound to.
 */
export class LogoutCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param refreshToken The refresh token identifying the session to revoke
     * @param principal The authenticated caller, used to ensure they own that session
     */
    constructor(
        readonly refreshToken: string,
        readonly principal: Principal,
    ) {
        super();
    }
}
