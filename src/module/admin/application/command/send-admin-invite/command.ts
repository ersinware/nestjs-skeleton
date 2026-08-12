/**
 * @file command.ts
 * @description Command that emails an activation invitation to a pending admin account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Emails a fresh activation invitation to a pending admin. Idempotent under redelivery: a repeated
 * send simply issues a newer link.
 */
export class SendAdminInviteCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param id The unique identifier of the pending admin
     */
    constructor(readonly id: string) {
        super();
    }
}
