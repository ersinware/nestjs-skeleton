/**
 * @file event-publisher.port.ts
 * @description Outbound port for publishing internal domain/application events.
 */

import type { DispatchedDomainEvent, DurableEvent } from 'src/shared/application/event';

/**
 * Dependency injection token representing the {@link IEventPublisherPort} contract.
 */
export const TOKEN_EVENT_PUBLISHER_PORT = Symbol('TOKEN_EVENT_PUBLISHER_PORT');

/**
 * Contract for publishing internal events.
 */
export interface IEventPublisherPort {
    /**
     * Accepts all target deliveries atomically. Joins the ambient transaction or opens a short one.
     * Within an outer transaction, acceptance is durable only after its commit; propagate failures.
     * Completion means persistence, never consumer completion. Does not generate or replace eventId.
     *
     * @param event Versioned event with a caller-created stable UUID v7 identity
     * @throws {SystemException} When routing is missing or a target delivery is not inserted
     * @throws {DependencyUnavailableException} When the database connection fails
     */
    publish(event: DurableEvent): Promise<void>;

    /**
     * Emits immediately and awaits every listener; delivery is not coordinated with DB commit.
     *
     * @param event The name of the event to emit.
     * @param payload The minimal-metadata payload delivered to every listener.
     * @throws {Error} Whatever a listener rejects with; awaiting delivery propagates listener failures.
     */
    emitAsync(event: string, payload: DispatchedDomainEvent): Promise<void>;
}
