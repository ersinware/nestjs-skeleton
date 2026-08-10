/**
 * @file command.ts
 * @description Command that revokes all of an admin's sessions after refresh-token reuse was detected.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Revokes all of an admin's sessions and notifies the account owner.
 */
export class RevokeAdminSessionsCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin whose sessions must be revoked
     */
    constructor(readonly id: string) {
        super();
    }
}
