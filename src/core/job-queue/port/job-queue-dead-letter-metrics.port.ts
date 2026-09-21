/**
 * @file job-queue-dead-letter-metrics.port.ts
 * @description Defines queue statistics required by dead-letter monitoring.
 */

/**
 * Dependency injection token representing the {@link IJobQueueDeadLetterMetricsPort} contract.
 */
export const TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT = Symbol('TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT');

/**
 * Queue counts used by dead-letter monitoring.
 */
export type DeadLetterQueueStats = {
    /**
     * Number of dead-letter jobs ready for operator action.
     */
    readonly readyCount: number;

    /**
     * Time at which pg-boss captured the queue counts.
     */
    readonly capturedOn: Date;
};

/**
 * Queue counts used by redrive-operation monitoring.
 */
export type DeadLetterRedriveQueueStats = {
    /**
     * Number of terminally failed redrive operations still retained.
     */
    readonly failedCount: number;

    /**
     * Time at which pg-boss captured the queue counts.
     */
    readonly capturedOn: Date;
};

/**
 * Samples queue counts required by dead-letter monitoring.
 */
export interface IJobQueueDeadLetterMetricsPort {
    /**
     * Samples current shared dead-letter queue counts.
     *
     * @returns Current ready count and capture time
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss returns no queue snapshot
     */
    getDeadLetterQueueStats(): Promise<DeadLetterQueueStats>;

    /**
     * Samples current redrive-operation queue counts.
     *
     * @returns Current failed count and capture time
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss returns no queue snapshot
     */
    getDeadLetterRedriveQueueStats(): Promise<DeadLetterRedriveQueueStats>;
}
