/**
 * @file job-queue-dead-letter-reader.port.ts
 * @description Defines read access to dead-letter jobs and redrive operations.
 */

import type { PaginationParams } from 'src/shared/pagination';

/**
 * Dependency injection token representing the {@link IJobQueueDeadLetterReaderPort} contract.
 */
export const TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT = Symbol();

/**
 * Sanitized internal view of one job stored in the shared dead-letter queue.
 */
export type DeadLetterJob = {
    /**
     * Dead-letter queue job identifier.
     */
    readonly id: string;

    /**
     * Time the dead-letter copy was created.
     */
    readonly createdOn: Date;

    /**
     * Queue on which the original job failed.
     */
    readonly sourceName: string;

    /**
     * Identifier of the original failed job.
     */
    readonly sourceId: string;

    /**
     * Time the original job was created.
     */
    readonly sourceCreatedOn: Date;

    /**
     * Retry count consumed by the original job.
     */
    readonly sourceRetryCount: number;

    /**
     * Logical delivery identifier of the original job.
     */
    readonly deliveryId: string;

    /**
     * Aggregate identifier of the original job.
     */
    readonly aggregateId: string;
};

/**
 * One bounded page of sanitized dead-letter jobs.
 */
export type DeadLetterJobPage = {
    /**
     * Jobs in the requested page, ordered newest first.
     */
    readonly data: readonly DeadLetterJob[];

    /**
     * Total number of matching jobs across all pages.
     */
    readonly total: number;
};

/**
 * Persisted status view of one dead-letter redrive operation.
 */
export type DeadLetterRedrive = {
    /**
     * Operation job identifier.
     */
    readonly id: string;

    /**
     * Current pg-boss lifecycle state.
     */
    readonly state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';

    /**
     * Time the operation was requested.
     */
    readonly createdOn: Date;

    /**
     * Terminal completion time when available.
     */
    readonly completedOn: Date | null;
};

/**
 * One bounded page of retained dead-letter redrive operations.
 */
export type DeadLetterRedrivePage = {
    /**
     * Redrives in the requested page, ordered newest first.
     */
    readonly data: readonly DeadLetterRedrive[];

    /**
     * Total number of matching redrives across all pages.
     */
    readonly total: number;
};

/**
 * Reads sanitized dead-letter jobs and redrive operation state.
 */
export interface IJobQueueDeadLetterReaderPort {
    /**
     * Lists one newest-first page from the shared dead-letter queue.
     *
     * @param params Shared page and limit parameters
     * @returns Sanitized page and matching job count
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job provenance or identifiers are missing or invalid
     */
    listDeadLetterJobs(params: PaginationParams): Promise<DeadLetterJobPage>;

    /**
     * Lists one newest-first page from the redrive orchestration queue.
     *
     * @param params Shared page and limit parameters
     * @returns Sanitized page and matching operation count
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted operation fields or page count are invalid
     */
    listDeadLetterRedrives(params: PaginationParams): Promise<DeadLetterRedrivePage>;
}
