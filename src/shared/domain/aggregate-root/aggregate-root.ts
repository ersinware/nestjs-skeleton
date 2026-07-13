/**
 * @file aggregate-root.ts
 * @description Base class for all Aggregate Roots in the domain. Handles domain event accumulation.
 */

import { DomainEvent } from 'src/shared/domain/event';

export abstract class AggregateRoot {
    readonly id: string;

    private readonly _domainEvents: DomainEvent[] = [];

    protected constructor(id: string) {
        this.id = id;
    }

    /**
     * Gets the uncommitted domain events.
     */
    get domainEvents(): DomainEvent[] {
        return this._domainEvents;
    }

    /**
     * Adds a domain event to the aggregate.
     * @param event The event to add
     */
    protected addDomainEvent(event: DomainEvent) {
        this._domainEvents.push(event);
    }

    /**
     * Clears all domain events after they have been persisted to the outbox.
     * Called by the Unit of Work after the transaction commits — not by repositories.
     */
    clearDomainEvents() {
        this._domainEvents.length = 0;
    }
}
