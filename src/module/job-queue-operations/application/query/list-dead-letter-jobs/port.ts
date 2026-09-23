/**
 * @file port.ts
 * @description Outbound read contract for listing dead-letter jobs.
 */

import type { ListDeadLetterJobsResult } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/query';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Dependency injection token for the {@link IListDeadLetterJobsPort} contract.
 */
export const TOKEN_LIST_DEAD_LETTER_JOBS_PORT = Symbol();

/**
 * Reads a bounded page of sanitized dead-letter jobs.
 */
export interface IListDeadLetterJobsPort {
    /**
     * Reads one page from the shared dead-letter queue.
     *
     * @param params Page and limit
     * @returns Sanitized page and matching count
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job identifiers or provenance are invalid
     */
    listJobs(params: PaginationParams): Promise<ListDeadLetterJobsResult>;
}
