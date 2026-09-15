/**
 * @file outbox-event.ts
 * @description Durable event envelope shared by outbox persistence and delivery.
 */

/**
 * Event routing and aggregate reference retained across delivery attempts.
 */
export type OutboxEvent = {
    /**
     * Owner-defined event name used by the in-process publisher.
     */
    readonly eventType: string;

    /**
     * Aggregate whose authoritative state listeners re-read.
     */
    readonly aggregateId: string;
};
