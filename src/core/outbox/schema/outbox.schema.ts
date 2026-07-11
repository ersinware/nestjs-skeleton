/**
 * @file outbox.schema.ts
 * @description Drizzle ORM schema definition for the outbox table.
 */

import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from 'src/core/database';
import { OutboxStatus } from 'src/core/outbox/enum';
import { uuidv7 } from 'uuidv7';

export const outboxStatusEnum = pgEnum('outbox_status', [
    OutboxStatus.PENDING,
    OutboxStatus.QUEUED,
    OutboxStatus.FAILED,
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
        ...timestamps,
    },
    (table) => [
        index('idx_outbox_pending_status')
            .on(table.id)
            .where(sql.raw(`status = '${OutboxStatus.PENDING}'`)),
    ],
);
