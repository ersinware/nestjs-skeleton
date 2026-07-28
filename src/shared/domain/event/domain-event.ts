/**
 * @file domain-event.ts
 * @description The single domain-event shape accumulated by an aggregate and dispatched by its writer adapter.
 */

/**
 * A domain event raised by an aggregate. Carries only the discriminating `type` and the
 * `aggregateId` re-fetch key (per the minimal-payload rule) — the concrete verb lives entirely in
 * `type` (e.g. `admin.banned`), so no per-event subclasses are needed.
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
