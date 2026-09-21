/**
 * @file job-consumer.interface.ts
 * @description Defines the contract and transaction mode for job consumers.
 */

import { Job } from 'src/core/job-queue/job.type';

/**
 * Application-owned queue topology that may differ per consumer.
 */
export type JobQueueOptions = {
    /**
     * Immutable queue delivery policy.
     */
    readonly policy: 'standard' | 'exclusive';

    /**
     * Destination for terminal failures, or null when dead-letter routing is disabled.
     */
    readonly deadLetter: string | null;
};

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
     * Queue topology overrides; standard delivery without dead-letter routing is the default.
     */
    readonly queueOptions?: Partial<JobQueueOptions>;

    /**
     * Processes one claimed job.
     *
     * @param job Job payload
     */
    consume(job: Job): Promise<void>;
}
