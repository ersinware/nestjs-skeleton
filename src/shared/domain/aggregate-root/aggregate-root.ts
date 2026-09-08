/**
 * @file aggregate-root.ts
 * @description Base class for all Aggregate Roots in the domain. Owns the identity and the persistence version, and handles domain event accumulation.
 */

import { DomainEvent } from 'src/shared/domain/event';

/**
 * Base class every Aggregate Root extends. Owns the identity and the persistence version, and
 * accumulates the domain events a mutation raises until the writer adapter pulls and dispatches them.
 */
export abstract class AggregateRoot {
    readonly id: string;

    /**
     * The persisted version this in-memory state was loaded at (0 for a new aggregate). The
     * optimistic-lock token: a writer saves only if the row still carries it, and stores it
     * incremented, so two handlers that loaded the same state cannot both write — the second
     * decided on a row that no longer exists and is refused. The aggregate never advances it: the
     * version counts persisted writes, not in-memory mutations, so it belongs to the writer.
     */
    readonly version: number;

    private readonly _domainEvents: DomainEvent[] = [];

    /**
     * Initializes the aggregate identity and persistence version.
     *
     * @param id The unique identifier
     * @param version The persisted version the state was loaded at; 0 for a new aggregate
     */
    protected constructor(id: string, version: number) {
        this.id = id;
        this.version = version;
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
