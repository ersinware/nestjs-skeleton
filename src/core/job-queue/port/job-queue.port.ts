/**
 * @file job-queue.port.ts
 * @description Vendor-independent registration and atomic persistence of background jobs.
 */

/**
 * Dependency injection token representing the {@link IJobQueuePort} contract.
 */
export const TOKEN_JOB_QUEUE_PORT = Symbol('TOKEN_JOB_QUEUE_PORT');

/**
 * Queue names owned by a caller, with no event or business vocabulary.
 */
export type JobQueueDefinition = {
    /**
     * PostgreSQL namespace owning these queues.
     */
    readonly schema: string;

    /**
     * Source queues; infrastructure derives their dead-letter queues.
     */
    readonly queues: readonly string[];
};

/**
 * Provides shared queue lifecycle and transactional job acceptance.
 */
export interface IJobQueuePort {
    /**
     * Registers a schema's complete queue inventory before application bootstrap.
     *
     * @param definition Caller-owned schema and source queues
     */
    register(definition: JobQueueDefinition): void;

    /**
     * Persists one job per target in the ambient transaction, or opens one when absent.
     * An outer transaction must commit before acceptance is durable; this does not await processing.
     *
     * @param schema Registered queue namespace
     * @param targets Queues receiving independent jobs with the same data
     * @param data JSON-serializable job data, interpreted only by its consumer
     * @throws {SystemException} When the schema is unregistered or a job is not inserted
     * @throws {DependencyUnavailableException} When a database connection failure prevents acceptance
     */
    enqueue(
        schema: string,
        targets: readonly [string, ...string[]],
        data: Readonly<Record<string, unknown>>,
    ): Promise<void>;
}
