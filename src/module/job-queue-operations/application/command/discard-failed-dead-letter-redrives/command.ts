/**
 * @file command.ts
 * @description Idempotent command for atomically discarding retained failed redrive operations.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Discards the specified failed redrive operations inside an atomic idempotency boundary.
 */
export class DiscardFailedDeadLetterRedrivesCommand extends Command<void> {
    /**
     * Initializes the logical request identity and target redrive operation identifiers.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint/principal/operation semantics
     * @param ids Non-empty, unique pg-boss orchestration job identifiers
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly ids: readonly string[],
    ) {
        super();
    }
}
