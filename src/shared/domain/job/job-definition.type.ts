/**
 * @file job-definition.type.ts
 * @description Defines a transport-neutral durable job raised by an aggregate.
 */

/**
 * Durable work routed to a named queue.
 */
export type JobDefinition = {
    /**
     * Idempotency key shared across delivery attempts.
     */
    readonly eventId: string;

    /**
     * Aggregate identifier used to re-read authoritative state.
     */
    readonly aggregateId: string;

    /**
     * Stable destination queue.
     */
    readonly queueName: string;
};
