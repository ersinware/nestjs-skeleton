/**
 * @file command.ts
 * @description Defines the command for inviting a new admin.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Invites a new admin by creating an account pending activation: it starts without a password and its owner
 * activates it through the emailed invitation. It starts with no permissions: authority is granted
 * afterwards, by an admin who holds it.
 */
export class InviteAdminCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint semantics
     * @param email The unique email address the invitation is sent to
     * @param name The display name of the new admin
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly email: string,
        readonly name: string,
    ) {
        super();
    }
}
