/**
 * @file schema.ts
 * @description Drizzle ORM schema for the outbox table — the durable, auditable ledger that backs
 * the transactional outbox pattern.
 */

import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from 'src/core/database';
import { OutboxStatus } from 'src/core/outbox/enum';
import { uuidv7 } from 'uuidv7';

export const outboxStatusEnum = pgEnum('outbox_status', [
    OutboxStatus.PENDING,
    OutboxStatus.PROCESSING,
    OutboxStatus.PUBLISHED,
    OutboxStatus.DEAD,
]);

export const outbox = pgTable(
    'outbox',
    {
        id: uuid('id')
            .primaryKey()
            .$defaultFn(() => uuidv7()),
        aggregateId: text('aggregate_id').notNull(),
        type: text('type').notNull(),
        status: outboxStatusEnum('status').notNull().default(OutboxStatus.PENDING),
        /** Lease boundary: the event is claimable once `now()` passes this timestamp. */
        availableAt: timestamp('available_at').notNull().defaultNow(),
        ...timestamps,
    },
    (table) => [
        index('idx_outbox_claimable')
            .on(table.id)
            .where(sql.raw(`status in ('${OutboxStatus.PENDING}', '${OutboxStatus.PROCESSING}')`)),
    ],
);
