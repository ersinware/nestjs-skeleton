/**
 * @file aggregate-root.ts
 * @description Base class for all Aggregate Roots in the domain. Handles domain event accumulation.
 */

import { DomainEvent } from 'src/shared/domain/event';

/**
 * Base class every Aggregate Root extends. Owns the identity and accumulates the domain events a
 * mutation raises until the writer adapter pulls and dispatches them.
 */
export abstract class AggregateRoot {
    readonly id: string;

    private readonly _domainEvents: DomainEvent[] = [];

    /**
     * Initializes the aggregate identity.
     *
     * @param id The unique identifier
     */
    protected constructor(id: string) {
        this.id = id;
    }

    /**
     * Adds a domain event to the aggregate.
     * @param event The event to add
     */
    protected addDomainEvent(event: DomainEvent) {
        this._domainEvents.push(event);
    }

    /**
     * Hands over the uncommitted domain events and clears them in one step, so the internal list is
     * never exposed to mutation. Called by the writer adapter when it dispatches them — not by the
     * application layer.
     *
     * @returns The domain events accumulated since the last pull
     */
    pullDomainEvents(): DomainEvent[] {
        const events = [...this._domainEvents];
        this._domainEvents.length = 0;

        return events;
    }
}
