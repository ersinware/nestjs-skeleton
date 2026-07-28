/**
 * @file dispatched-domain-event.type.ts
 * @description Payload delivered to in-process listeners when a domain event is dispatched on the bus.
 */

/**
 * Payload every `@OnEvent` listener receives. Distinct from the raised `DomainEvent`: it omits
 * `type` (the listener already knows it via `@OnEvent`) and adds `eventId`.
 */
export type DispatchedDomainEvent = {
    /** Id of the aggregate that raised the event — the re-fetch key, per the minimal-payload rule. */
    readonly aggregateId: string;

    /** Unique per dispatch; the idempotency key for consumers whose side effects are harmful to repeat. */
    readonly eventId: string;
};
