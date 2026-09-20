/**
 * @file job-consumer.interface.ts
 * @description Defines the contract and transaction mode for job consumers.
 */

import { Job } from 'src/core/job-queue/job.type';

/**
 * Processes jobs using an explicitly declared transaction mode.
 */
export interface IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name: string;

    /**
     * Whether database effects and job completion commit together.
     */
    readonly transactional: boolean;

    /**
     * Processes one claimed job.
     *
     * @param job Job payload
     */
    consume(job: Job): Promise<void>;
}
