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
     * Whether terminal failures bypass the shared dead-letter queue.
     */
    readonly disableDeadLetter: boolean;
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
     * Transactional workflows use ITransactionPort.join and perform no external business effects.
     * Non-transactional workflows must resume safely across retries after independently committed work.
     */
    readonly transactional: boolean;

    /**
     * Queue topology overrides; standard delivery into the shared DLQ is the default.
     * Set disableDeadLetter to true for a technical queue that must not route failures.
     */
    readonly queueOptions?: Partial<JobQueueOptions>;

    /**
     * Explicit per-process worker configuration for this queue.
     */
    readonly workerOptions: {
        /**
         * Number of independent workers for this queue in each process.
         */
        readonly localConcurrency: number;

        /**
         * Polling interval in seconds.
         */
        readonly pollingIntervalSeconds: number;

        /**
         * Maximum jobs claimed per fetch and processed sequentially by each worker.
         */
        readonly batchSize: number;
    };

    /**
     * Processes one claimed job.
     *
     * @param job Job payload
     */
    consume(job: Job): Promise<void>;
}
