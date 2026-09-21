/**
 * @file command.ts
 * @description Command to discard exact jobs from the shared dead-letter queue.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Discards the specified dead-letter jobs as one atomic operator action.
 */
export class DiscardDeadLetterJobsCommand extends Command<void> {
    /**
     * Initializes the exact job identifiers to discard.
     *
     * @param jobIds Non-empty, unique pg-boss job identifiers
     */
    constructor(readonly jobIds: readonly string[]) {
        super();
    }
}
