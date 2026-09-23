/**
 * @file job-queue-writer.port.ts
 * @description Defines durable job publishing for aggregate writers.
 */

import type { JobDefinition } from 'src/shared/domain/job';

/**
 * Identifies the {@link IJobQueueWriterPort} contract.
 */
export const TOKEN_JOB_QUEUE_WRITER_PORT = Symbol();

/**
 * Persists jobs through the caller's database transaction.
 */
export interface IJobQueueWriterPort {
    /**
     * Enqueues all supplied jobs atomically when called inside a transaction.
     *
     * @param jobs Jobs to enqueue
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss does not accept every job
     */
    enqueue(jobs: readonly JobDefinition[]): Promise<void>;
}
