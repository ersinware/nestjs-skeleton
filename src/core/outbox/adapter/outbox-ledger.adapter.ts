/**
 * @file outbox-ledger.adapter.ts
 * @description Drizzle ORM implementation of the IOutboxLedgerPort (outbox ledger persistence).
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database/constant/constant';
import { OutboxStatus } from 'src/core/outbox/enum';
import type { IOutboxLedgerPort } from 'src/core/outbox/port';
import { outbox } from 'src/core/outbox/schema';
import type { ClaimedOutboxEvent } from 'src/core/outbox/type';
import type { DomainEvent } from 'src/shared/domain/event';

/**
 * Drizzle ORM implementation of the Outbox Ledger Port. Handles all database operations for the
 * outbox ledger table.
 */
@Injectable()
export class OutboxLedgerAdapter implements IOutboxLedgerPort {
    /**
     * Creates an instance of OutboxLedgerAdapter.
     *
     * @param db - The PostgresJs Drizzle database instance (transaction-aware proxy).
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Persists a batch of domain events into the outbox table, within the caller's active transaction.
     *
     * @param events - Array of domain events to be persisted.
     * @throws Throws if the database insertion fails.
     */
    async saveEvents(events: DomainEvent[]) {
        await this.db.insert(outbox).values(events);
    }

    /**
     * Atomically claims a batch of dispatchable events in a single statement: an inner
     * `SELECT ... FOR UPDATE SKIP LOCKED` picks claimable rows (`PENDING`, or `PROCESSING` with an
     * expired lease) so concurrent relays never grab the same rows, and the outer `UPDATE` moves them
     * to `PROCESSING` with a fresh lease, returning the claimed rows via `RETURNING`. `updated_at` is
     * stamped explicitly here because Drizzle's `$onUpdate` only fires on its query builder, not raw SQL.
     *
     * @param limit - Maximum number of events to claim.
     * @param leaseMs - Lease duration in milliseconds to apply to the claimed rows.
     * @returns The claimed events.
     * @throws Throws if the database operation fails.
     */
    async claimEvents(limit: number, leaseMs: number): Promise<ClaimedOutboxEvent[]> {
        return this.db.execute<ClaimedOutboxEvent>(sql`
            UPDATE ${outbox}
            SET
                status = ${OutboxStatus.PROCESSING},
                available_at = now() + ${leaseMs} * interval '1 millisecond',
                updated_at = now()
            WHERE id IN (
                SELECT id
                FROM ${outbox}
                WHERE
                    status = ${OutboxStatus.PENDING}
                    OR (status = ${OutboxStatus.PROCESSING} AND available_at < now())
                ORDER BY id ASC
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, type, aggregate_id AS "aggregateId"
        `);
    }

    /**
     * Marks events as successfully published (terminal success state).
     *
     * @param ids - Array of event identifiers to mark.
     * @throws Throws if the database update fails.
     */
    async markPublished(ids: string[]) {
        await this.db.update(outbox).set({ status: OutboxStatus.PUBLISHED }).where(inArray(outbox.id, ids));
    }

    /**
     * Marks events as dead-lettered after retries are exhausted (terminal failure state).
     *
     * @param ids - Array of event identifiers to mark.
     * @throws Throws if the database update fails.
     */
    async markDead(ids: string[]) {
        await this.db.update(outbox).set({ status: OutboxStatus.DEAD }).where(inArray(outbox.id, ids));
    }

    /**
     * Deletes `PUBLISHED` rows last updated before the given cutoff.
     *
     * @param olderThan - Cutoff timestamp; rows updated before this are removed.
     * @returns The number of rows removed.
     * @throws Throws if the database deletion fails.
     */
    async prunePublished(olderThan: Date): Promise<number> {
        return (
            await this.db
                .delete(outbox)
                .where(and(eq(outbox.status, OutboxStatus.PUBLISHED), lt(outbox.updatedAt, olderThan)))
                .returning({ id: outbox.id })
        ).length;
    }
}
