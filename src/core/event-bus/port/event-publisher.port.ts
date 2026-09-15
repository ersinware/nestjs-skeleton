/**
 * @file event-publisher.port.ts
 * @description Outbound port for publishing internal domain/application events.
 */

import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Dependency injection token representing the {@link IEventPublisherPort} contract.
 */
export const TOKEN_EVENT_PUBLISHER_PORT = Symbol('TOKEN_EVENT_PUBLISHER_PORT');

/**
 * Contract for publishing internal events.
 */
export interface IEventPublisherPort {
    /**
     * Emits immediately and awaits every listener; delivery is not coordinated with DB commit.
     *
     * @param event The name of the event to emit.
     * @param payload The minimal-metadata payload delivered to every listener.
     * @throws {Error} Whatever a listener rejects with; awaiting delivery propagates listener failures.
     */
    emitAsync(event: string, payload: DispatchedDomainEvent): Promise<void>;
}
