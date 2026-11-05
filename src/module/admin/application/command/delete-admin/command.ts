/**
 * @file command.ts
 * @description Command that soft-deletes an admin account.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Soft-deletes an admin account.
 */
export class DeleteAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint, actor, and target semantics
     * @param id The unique identifier of the admin to delete
     * @param actor The verified principal performing the action, weighed against the target by the aggregate
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly id: string,
        readonly actor: Principal,
    ) {
        super();
    }
}
