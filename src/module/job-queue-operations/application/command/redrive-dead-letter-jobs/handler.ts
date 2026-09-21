/**
 * @file handler.ts
 * @description Drains eligible dead-letter jobs through the pg-boss redrive operation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT, type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import { RedriveDeadLetterJobsCommand } from 'src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/command';

/**
 * Bounds each database operation while allowing the orchestration job to drain the queue.
 */
const INTERNAL_BATCH_SIZE = 100;

/**
 * Moves all currently redrivable jobs to their recorded source queues.
 */
@CommandHandler(RedriveDeadLetterJobsCommand)
export class RedriveDeadLetterJobsCommandHandler implements ICommandHandler<RedriveDeadLetterJobsCommand, void> {
    /**
     * Initializes the handler with the shared dead-letter operator port.
     *
     * @param operatorPort Redrive batch operation
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT)
        private readonly operatorPort: IJobQueueDeadLetterOperatorPort,
    ) {}

    /**
     * Continues until pg-boss finds no eligible jobs; retries resume from the remaining rows.
     */
    async execute() {
        let moved: number;

        do {
            moved = await this.operatorPort.redriveDeadLetterJobs(INTERNAL_BATCH_SIZE);
        } while (moved > 0);
    }
}
