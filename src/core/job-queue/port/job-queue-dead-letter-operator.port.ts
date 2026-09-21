/**
 * @file job-queue-dead-letter-operator.port.ts
 * @description Defines controlled mutation operations for the shared dead-letter queue.
 */

/**
 * Dependency injection token representing the {@link IJobQueueDeadLetterOperatorPort} contract.
 */
export const TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT = Symbol('TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT');

/**
 * Performs controlled dead-letter discard and redrive operations.
 */
export interface IJobQueueDeadLetterOperatorPort {
    /**
     * Deletes exact IDs only from the shared dead-letter queue.
     *
     * @param ids Dead-letter job identifiers
     * @returns Number of rows deleted
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss returns an invalid mutation result
     */
    discardDeadLetterJobs(ids: readonly string[]): Promise<number>;

    /**
     * Enqueues an exclusive redrive operation through the ambient database transaction.
     *
     * @param operationId Identifier chosen by the caller for audit and status correlation
     * @returns True when accepted, or false when the exclusive queue rejects the operation
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss accepts the job under an unexpected identifier
     */
    enqueueDeadLetterRedrive(operationId: string): Promise<boolean>;

    /**
     * Moves one bounded batch from the shared dead-letter queue to recorded source queues.
     *
     * @param limit Internal maximum number of jobs to move
     * @returns Number of jobs moved
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    redriveDeadLetterJobs(limit: number): Promise<number>;
}
