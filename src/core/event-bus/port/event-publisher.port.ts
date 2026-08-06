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
     * Emits an event and awaits every listener.
     *
     * @param event The name of the event to emit.
     * @param payload The minimal-metadata payload delivered to every listener.
     * @throws {Error} Whatever a listener rejects with — awaiting delivery propagates listener
     * failures to the emitter.
     */
    emitAsync(event: string, payload: DispatchedDomainEvent): Promise<void>;
}
