/**
 * @file outbox-ledger.port.ts
 * @description Outbound port for the outbox ledger — persisting, claiming, finalising and pruning
 * domain events. Implemented by a Drizzle adapter.
 */

import { ClaimedOutboxEvent } from 'src/core/outbox/type';
import { DomainEvent } from 'src/shared/domain/event';

/**
 * Dependency injection token representing the outbox ledger port.
 */
export const TOKEN_OUTBOX_LEDGER_PORT = Symbol('TOKEN_OUTBOX_LEDGER_PORT');

/**
 * Core interface for interacting with the outbox ledger persistence layer.
 */
export interface IOutboxLedgerPort {
    /**
     * Persists a batch of domain events into the outbox, within the caller's active transaction.
     *
     * @param events - The domain events to save.
     * @throws Throws if the database insertion fails.
     */
    saveEvents(events: DomainEvent[]): Promise<void>;

    /**
     * Atomically claims a batch of dispatchable events and returns them. A row is claimable when it
     * is `PENDING`, or when it is `PROCESSING` but its lease has expired — the latter is how orphaned
     * events (lost BullMQ jobs, crashed workers) are recovered. Claimed rows are moved to
     * `PROCESSING`, their attempt counter is incremented, and a fresh lease is applied.
     *
     * @param limit - Maximum number of events to claim in this batch.
     * @param leaseMs - Lease duration in milliseconds applied to the claimed rows.
     * @returns The claimed events.
     * @throws Throws if the database operation fails.
     */
    claimEvents(limit: number, leaseMs: number): Promise<ClaimedOutboxEvent[]>;

    /**
     * Marks events as successfully published (terminal success state).
     *
     * @param ids - Identifiers of the events to mark.
     * @throws Throws if the database update fails.
     */
    markPublished(ids: string[]): Promise<void>;

    /**
     * Marks events as dead-lettered after retries are exhausted (terminal failure state).
     *
     * @param ids - Identifiers of the events to mark.
     * @throws Throws if the database update fails.
     */
    markDead(ids: string[]): Promise<void>;

    /**
     * Deletes `PUBLISHED` rows last updated before the given cutoff, keeping the ledger bounded.
     *
     * @param olderThan - Cutoff timestamp; rows updated before this are removed.
     * @returns The number of rows removed.
     * @throws Throws if the database deletion fails.
     */
    prunePublished(olderThan: Date): Promise<number>;
}
