/**
 * @file command.ts
 * @description Command requesting another activation email for a pending user account.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Requests activation delivery by account email without disclosing account state.
 */
export class ResendUserActivationCommand extends Command<void> {
    /**
     * Initializes the command with the normalized email address.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint semantics
     * @param email The account email address
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly email: string,
    ) {
        super();
    }
}
