/**
 * @file job-queue-dead-letter-metrics.port.ts
 * @description Defines queue statistics required by dead-letter monitoring.
 */

/**
 * Dependency injection token representing the {@link IJobQueueDeadLetterMetricsPort} contract.
 */
export const TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT = Symbol('TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT');

/**
 * Samples queue counts required by dead-letter monitoring.
 */
export interface IJobQueueDeadLetterMetricsPort {
    /**
     * Samples current shared dead-letter queue counts.
     *
     * @returns Number of dead-letter jobs ready for operator action
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss returns no queue snapshot
     */
    getDeadLetterReadyCount(): Promise<number>;

    /**
     * Samples current redrive-operation queue counts.
     *
     * @returns Number of terminally failed redrive operations still retained
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss returns no queue snapshot
     */
    getDeadLetterRedriveFailedCount(): Promise<number>;

    /**
     * Reads the creation time of the oldest retained shared dead-letter job.
     *
     * @returns Oldest creation time, or null when the queue is empty
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When the result row is missing or the persisted timestamp is invalid
     */
    getOldestDeadLetterCreatedOn(): Promise<Date | null>;
}
