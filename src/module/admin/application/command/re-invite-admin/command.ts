/**
 * @file command.ts
 * @description Command that revokes earlier invitations and requests a replacement for a pending admin account.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Re-issues a pending admin's invitation and invalidates earlier links through the revocation version.
 */
export class ReInviteAdminCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint semantics
     * @param id The unique identifier of the pending admin
     * @param actor The verified principal requesting the invitation
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly id: string,
        readonly actor: Principal,
    ) {
        super();
    }
}
