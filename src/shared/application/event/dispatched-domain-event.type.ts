/**
 * @file dispatched-domain-event.type.ts
 * @description Payload delivered to in-process listeners when the outbox relay dispatches a domain event.
 */

/**
 * Payload every `@OnEvent` listener receives for a dispatched domain event. Distinct from the raised
 * `DomainEvent`: it omits `type` (the listener already knows it via `@OnEvent`) and adds `eventId` for
 * consumer-side idempotency. `aggregateId` is the id of the aggregate that raised the event (a re-fetch
 * key, per the minimal-payload rule); `eventId` is the unique outbox event id, used as the idempotency
 * key by consumers that guard their side effects with the inbox.
 */
export type DispatchedDomainEvent = {
    readonly aggregateId: string;
    readonly eventId: string;
};
