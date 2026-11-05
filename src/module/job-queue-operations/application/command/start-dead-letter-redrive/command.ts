/**
 * @file command.ts
 * @description Command to request an asynchronous redrive of the shared dead-letter queue.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Starts one exclusive operation to redrive all currently eligible dead-letter jobs.
 */
export class StartDeadLetterRedriveCommand extends Command<string> {
    /**
     * Initializes the logical HTTP request identity.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint/principal semantics
     */
    constructor(readonly idempotencyRequest: IdempotencyRequest) {
        super();
    }
}
