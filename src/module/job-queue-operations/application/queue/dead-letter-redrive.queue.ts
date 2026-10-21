/**
 * @file dead-letter-redrive.queue.ts
 * @description Dispatches exclusive dead-letter redrive jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import {
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS,
    type IJobConsumer,
} from 'src/core/job-queue';
import { RedriveDeadLetterJobsCommand } from 'src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/command';

/**
 * Consumes one exclusive, non-transactional orchestration job.
 */
@Injectable()
export class DeadLetterRedriveQueue implements IJobConsumer {
    /**
     * Technical queue coordinating redrive across application replicas.
     */
    readonly name = JOB_QUEUE_DEAD_LETTER_REDRIVE;

    /**
     * Queue policy and disabled dead-letter routing for orchestration failures.
     */
    readonly queueOptions = JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS;

    /**
     * Each redrive batch commits independently of job completion.
     */
    readonly transactional = false;

    /**
     * Polls infrequent orchestration work with one worker for the globally exclusive queue.
     */
    readonly workerOptions = { localConcurrency: 1, pollingIntervalSeconds: 30, batchSize: 1 } as const;

    /**
     * Initializes the consumer with the command pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch the drain command
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Drains eligible jobs without reading the orchestration job's empty payload.
     */
    async consume() {
        await this.commandPipeline.execute(new RedriveDeadLetterJobsCommand());
    }
}
