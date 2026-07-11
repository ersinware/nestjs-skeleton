/**
 * @file event-bus.port.ts
 * @description Defines the port (interface) for the application's internal event bus system.
 */

/** Injection token for the event bus port. */
export const TOKEN_EVENT_BUS_PORT = Symbol('TOKEN_EVENT_BUS_PORT');

/**
 * Interface defining the contract for publishing internal domain/application events.
 */
export interface IEventBusPort {
    /**
     * Asynchronously emits an event to all registered listeners.
     *
     * @param event The name of the event to emit.
     * @param payload The data associated with the event.
     */
    emitAsync(event: string, payload: unknown): Promise<void>;
}
