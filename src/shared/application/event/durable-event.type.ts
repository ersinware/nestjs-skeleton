/**
 * @file durable-event.type.ts
 * @description Transport-neutral identity and aggregate reference for durable acceptance.
 */

/**
 * One logical event; create its UUID v7 eventId once before acceptance and preserve it on redelivery.
 */
export type DurableEvent = {
    /**
     * Stable logical identity, independent of delivery job IDs.
     */
    readonly eventId: string;

    /**
     * Versioned operation contract, for example user.updated.v1.
     */
    readonly eventType: string;

    /**
     * Authoritative re-read key; no business snapshot travels with the event.
     */
    readonly aggregateId: string;
};
