/**
 * @file domain-event.ts
 * @description The single domain-event shape accumulated by an aggregate and dispatched by its writer
 * adapter. Carries only the discriminating `type` and the `aggregateId` re-fetch key (per the
 * minimal-payload rule) — the concrete verb lives entirely in `type`, so no per-event subclasses are
 * needed.
 */

/**
 * A domain event raised by an aggregate. `type` is the event discriminator (e.g. `admin.banned`) that
 * listeners subscribe to; `aggregateId` is the id of the aggregate that raised it, used by consumers
 * as the re-fetch key.
 */
export class DomainEvent {
    /**
     * Initializes a domain event.
     *
     * @param type The event type discriminator that listeners subscribe to
     * @param aggregateId The id of the aggregate that raised the event
     */
    constructor(
        readonly type: string,
        readonly aggregateId: string,
    ) {}
}
