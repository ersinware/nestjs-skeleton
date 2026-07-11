/**
 * @file outbox.adapter.ts
 * @description Drizzle ORM implementation of the IOutboxPort.
 */

import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database/constant/constant';
import { OutboxStatus } from 'src/core/outbox/enum';
import type { IOutboxPort } from 'src/core/outbox/port';
import { outbox } from 'src/core/outbox/schema';
import type { PendingOutboxEvent } from 'src/core/outbox/type';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Drizzle ORM implementation of the Outbox Port.
 * Handles database operations for the outbox table.
 */
@Injectable()
export class OutboxAdapter implements IOutboxPort {
    /**
     * Creates an instance of OutboxAdapter.
     *
     * @param db - The PostgresJs Drizzle database instance.
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Saves a batch of domain events into the outbox table within a database transaction.
     *
     * @param events - Array of domain events to be persisted.
     * @throws Throws if the database insertion fails.
     */
    async saveEvents(events: IDomainEvent[]) {
        await this.db.insert(outbox).values(
            events.map((event) => ({
                aggregateId: event.id,
                type: event.type,
            })),
        );
    }

    /**
     * Retrieves the oldest pending events from the outbox table.
     *
     * @param limit - The maximum number of events to fetch in this batch.
     * @returns A promise resolving to an array of pending outbox events.
     * @throws Throws if the database query fails.
     */
    async getPendingEvents(limit: number = 50): Promise<PendingOutboxEvent[]> {
        return this.db
            .select({
                id: outbox.id,
                type: outbox.type,
                aggregateId: outbox.aggregateId,
            })
            .from(outbox)
            .where(eq(outbox.status, OutboxStatus.PENDING))
            .orderBy(asc(outbox.id))
            .limit(limit)
            .for('update', { skipLocked: true });
    }

    /**
     * Updates the status of specific events in the outbox table.
     *
     * @param ids - Array of unique event identifiers to be updated.
     * @param status - The new status to apply to the events.
     * @throws Throws if the database update fails.
     */
    async updateStatus(ids: string[], status: OutboxStatus): Promise<void> {
        await this.db.update(outbox).set({ status }).where(inArray(outbox.id, ids));
    }

    /**
     * Deletes successfully processed events from the outbox table.
     *
     * @param ids - Array of unique event identifiers to be removed.
     * @throws Throws if the database deletion fails.
     */
    async deleteEvents(ids: string[]) {
        await this.db.delete(outbox).where(inArray(outbox.id, ids));
    }
}
