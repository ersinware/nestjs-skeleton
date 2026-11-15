/**
 * @file job-queue-dead-letter-operator.port.ts
 * @description Defines controlled mutation operations for the shared dead-letter queue.
 */

/**
 * Dependency injection token representing the {@link IJobQueueDeadLetterOperatorPort} contract.
 */
export const TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT = Symbol();

/**
 * Outcomes produced when attempting to discard retained redrive operations.
 */
export enum RedriveDiscardOutcome {
    /**
     * Every requested terminally failed orchestration job was deleted.
     */
    DISCARDED = 'DISCARDED',

    /**
     * At least one requested orchestration job does not exist or is no longer retained.
     */
    NOT_FOUND = 'NOT_FOUND',

    /**
     * At least one requested orchestration job is not in the failed state and cannot be discarded.
     */
    NOT_FAILED = 'NOT_FAILED',
}

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
     * @param id Identifier chosen by the caller for audit correlation
     * @returns True when accepted, or false when the exclusive queue rejects the operation
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    enqueueDeadLetterRedrive(id: string): Promise<boolean>;

    /**
     * Moves one bounded batch from the shared dead-letter queue to recorded source queues.
     *
     * @param limit Internal maximum number of jobs to move
     * @returns Number of jobs moved
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    redriveDeadLetterJobs(limit: number): Promise<number>;

    /**
     * Atomically deletes exact terminally failed redrive operations through the ambient database transaction.
     *
     * @param ids Redrive orchestration job identifiers
     * @returns Outcome indicating deletion, absence, or a non-failed state
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When pg-boss returns an invalid mutation result
     */
    discardFailedDeadLetterRedrives(ids: readonly string[]): Promise<RedriveDiscardOutcome>;
}
