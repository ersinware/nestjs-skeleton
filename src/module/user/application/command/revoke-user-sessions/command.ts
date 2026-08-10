/**
 * @file command.ts
 * @description Defines the RevokeUserSessionsCommand, dispatched when auth reports refresh-token reuse
 * for a user so the user module can revoke every session and warn the account owner.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to revoke all of a user's sessions after refresh-token reuse was detected.
 */
export class RevokeUserSessionsCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user whose sessions must be revoked
     */
    constructor(readonly id: string) {
        super();
    }
}
