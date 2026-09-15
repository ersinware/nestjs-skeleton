/**
 * @file outbox-writer.port.ts
 * @description The port for saving domain events to the outbox.
 */

import type { OutboxEvent } from 'src/core/outbox/outbox-event';

/**
 * Dependency injection token representing the {@link IOutboxWriterPort} contract.
 */
export const TOKEN_OUTBOX_WRITER_PORT = Symbol('IOutboxWriterPort');

/**
 * Contract for persisting domain events to the outbox.
 */
export interface IOutboxWriterPort {
    /**
     * Enqueues events through the primary database proxy. Call within ITransactionPort.run
     * to commit them atomically with business writes.
     *
     * @param events Event routing names and aggregate references; an empty batch is a no-op
     * @throws {SystemException} When the queue does not accept every event
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    save(...events: readonly OutboxEvent[]): Promise<void>;
}
