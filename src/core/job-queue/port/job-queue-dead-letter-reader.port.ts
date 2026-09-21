/**
 * @file job-queue-dead-letter-reader.port.ts
 * @description Defines read access to dead-letter jobs and redrive operations.
 */

/**
 * Dependency injection token representing the {@link IJobQueueDeadLetterReaderPort} contract.
 */
export const TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT = Symbol('TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT');

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
 * Persisted status view of one dead-letter redrive operation.
 */
export type DeadLetterRedriveOperation = {
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
 * Reads sanitized dead-letter jobs and redrive operation state.
 */
export interface IJobQueueDeadLetterReaderPort {
    /**
     * Loads one job from the shared dead-letter queue.
     *
     * @param id Dead-letter job identifier
     * @returns The job view, or null when it does not exist in the shared queue
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job provenance or identifiers are missing or invalid
     */
    getDeadLetterJob(id: string): Promise<DeadLetterJob | null>;

    /**
     * Loads one redrive operation status.
     *
     * @param operationId Redrive operation identifier
     * @returns The operation view, or null when it is not retained in the orchestration queue
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    getDeadLetterRedrive(operationId: string): Promise<DeadLetterRedriveOperation | null>;
}
