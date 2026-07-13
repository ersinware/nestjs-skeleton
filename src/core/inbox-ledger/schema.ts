/**
 * @file schema.ts
 * @description Drizzle schema for the inbox dedup ledger — records which `(consumer, event)` pairs
 * have already been handled, so at-least-once delivery becomes effectively-once at each consumer.
 */

import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const inboxLedger = pgTable(
    'inbox_ledger',
    {
        /** Stable identifier of the consumer (typically the listener class name). */
        consumer: text('consumer').notNull(),

        /** Unique event id (the outbox row id) that this consumer has processed. */
        eventId: text('event_id').notNull(),

        /** When the event was first processed by this consumer. */
        processedAt: timestamp('processed_at').notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.consumer, table.eventId] })],
);
