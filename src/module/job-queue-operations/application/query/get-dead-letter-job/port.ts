/**
 * @file port.ts
 * @description Outbound read contract for one dead-letter job.
 */

import type { GetDeadLetterJobResult } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/query';

/**
 * Dependency injection token for the {@link IGetDeadLetterJobPort} contract.
 */
export const TOKEN_GET_DEAD_LETTER_JOB_PORT = Symbol();

/**
 * Reads one sanitized job from the shared dead-letter queue.
 */
export interface IGetDeadLetterJobPort {
    /**
     * Retrieves a job by its dead-letter identifier.
     *
     * @param id Dead-letter job identifier
     * @returns Job or null when absent from the shared queue
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job identifiers or provenance are invalid
     */
    getJob(id: string): Promise<GetDeadLetterJobResult | null>;
}
