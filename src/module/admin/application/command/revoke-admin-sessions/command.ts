/**
 * @file command.ts
 * @description Defines the RevokeAdminSessionsCommand, dispatched when auth reports refresh-token reuse
 * for an admin so the admin module can revoke every session and warn the account owner.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to revoke all of an admin's sessions after refresh-token reuse was detected.
 */
export class RevokeAdminSessionsCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin whose sessions must be revoked
     * @param integrationEventId The originating reuse integration event id, used as the email idempotency key
     */
    constructor(
        readonly id: string,
        readonly integrationEventId: string,
    ) {
        super();
    }
}
