/**
 * @file exception.ts
 * @description Marker error signalling that an outbox event can never succeed on retry (a "poison"
 * message).
 */

/**
 * Thrown by an event consumer when a failure is permanent — a malformed payload, a referenced
 * aggregate that is gone for good, and so on. The outbox processor translates this into BullMQ's
 * `UnrecoverableError` so the event is dead-lettered immediately instead of exhausting its retries,
 * while keeping consumers decoupled from the queue technology.
 */
export class NonRetriableEventError extends Error {
    /**
     * @param message - Human-readable reason the event can never succeed.
     */
    constructor(message: string) {
        super(message);
        this.name = NonRetriableEventError.name;
    }
}
