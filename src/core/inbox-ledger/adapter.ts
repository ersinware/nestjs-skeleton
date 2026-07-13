/**
 * @file adapter.ts
 * @description Drizzle implementation of the IInboxLedgerPort, backed by the `inbox_ledger` table.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactionStorage } from 'src/core/database';
import { TOKEN_DATABASE } from 'src/core/database/constant/constant';
import type { IInboxLedgerPort } from 'src/core/inbox-ledger/port';
import { inboxLedger } from 'src/core/inbox-ledger/schema';

/**
 * Drizzle ORM implementation of the inbox (consumer-side idempotency) port.
 */
@Injectable()
export class InboxLedgerAdapter implements IInboxLedgerPort {
    /**
     * Creates an instance of InboxLedgerAdapter.
     *
     * @param db - The PostgresJs Drizzle database instance (transaction-aware proxy).
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Runs `work` at most once per `(consumer, eventId)`, atomically with the dedup marker. The marker
     * insert and `work` share one transaction, so any database writes performed by `work` (via the
     * transaction-aware proxy) commit or roll back together with the marker.
     *
     * @param consumer - Stable consumer identifier.
     * @param eventId - Idempotency key.
     * @param work - Side effect to run exactly once.
     * @returns `true` if `work` ran, `false` if the event was already processed.
     * @throws Throws if the database operation or `work` fails.
     */
    async runOnce(consumer: string, eventId: string, work: () => Promise<void>): Promise<boolean> {
        return this.db.transaction((tx) =>
            transactionStorage.run(tx, async () => {
                const inserted = await tx
                    .insert(inboxLedger)
                    .values({ consumer, eventId })
                    .onConflictDoNothing()
                    .returning({ eventId: inboxLedger.eventId });

                if (inserted.length === 0) {
                    return false;
                }

                await work();

                return true;
            }),
        );
    }

    /**
     * Reports whether `(consumer, eventId)` has already been processed.
     *
     * @param consumer - Stable consumer identifier.
     * @param eventId - Idempotency key.
     * @returns `true` if already processed.
     * @throws Throws if the database query fails.
     */
    async isProcessed(consumer: string, eventId: string): Promise<boolean> {
        return (
            (
                await this.db
                    .select({ eventId: inboxLedger.eventId })
                    .from(inboxLedger)
                    .where(and(eq(inboxLedger.consumer, consumer), eq(inboxLedger.eventId, eventId)))
                    .limit(1)
            ).length > 0
        );
    }

    /**
     * Records `(consumer, eventId)` as processed. Idempotent.
     *
     * @param consumer - Stable consumer identifier.
     * @param eventId - Idempotency key.
     * @throws Throws if the database write fails.
     */
    async markProcessed(consumer: string, eventId: string) {
        await this.db.insert(inboxLedger).values({ consumer, eventId }).onConflictDoNothing();
    }

    /**
     * Deletes dedup markers first processed before the given cutoff.
     *
     * @param olderThan - Cutoff timestamp; markers processed before this are removed.
     * @returns The number of markers removed.
     * @throws Throws if the database deletion fails.
     */
    async prune(olderThan: Date): Promise<number> {
        return (
            await this.db
                .delete(inboxLedger)
                .where(lt(inboxLedger.processedAt, olderThan))
                .returning({ eventId: inboxLedger.eventId })
        ).length;
    }
}
