/**
 * @file outbox.port.ts
 * @description Outbound port for saving domain events to the outbox.
 */

import { OutboxStatus } from 'src/core/outbox/enum';
import { PendingOutboxEvent } from 'src/core/outbox/type';
import { IDomainEvent } from 'src/shared/domain/event';

/**
 * Dependency injection token representing the outbox port.
 */
export const TOKEN_OUTBOX_PORT = Symbol('TOKEN_OUTBOX_PORT');

/**
 * Core interface for interacting with the outbox persistence layer.
 */
export interface IOutboxPort {
    /**
     * Saves a batch of domain events to the outbox.
     *
     * @param events - The domain events to save.
     * @throws Throws if the database operation fails.
     */
    saveEvents(events: IDomainEvent[]): Promise<void>;

    /**
     * Retrieves a batch of pending events from the outbox.
     *
     * @param limit - Maximum number of events to fetch.
     * @returns A promise resolving to an array of pending events.
     * @throws Throws if the database query fails.
     */
    getPendingEvents(limit: number): Promise<PendingOutboxEvent[]>;

    updateStatus(ids: string[], status: OutboxStatus): Promise<void>;

    /**
     * Deletes events from the outbox by their IDs.
     *
     * @param ids - Array of event IDs to delete.
     * @throws Throws if the database deletion fails.
     */
    deleteEvents(ids: string[]): Promise<void>;
}
