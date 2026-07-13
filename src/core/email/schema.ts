/**
 * @file schema.ts
 * @description Drizzle ORM schema for the email table — the durable, auditable ledger that makes
 * email delivery survive a Redis/BullMQ loss. Email intent is written here first, then a relay
 * dispatches it, mirroring the transactional outbox pattern.
 */

import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from 'src/core/database';
import { EmailStatus } from 'src/core/email/enum';
import { uuidv7 } from 'uuidv7';

export const emailStatusEnum = pgEnum('email_status', [
    EmailStatus.PENDING,
    EmailStatus.PROCESSING,
    EmailStatus.SENT,
    EmailStatus.DEAD,
]);

export const email = pgTable(
    'email',
    {
        id: uuid('id')
            .primaryKey()
            .$defaultFn(() => uuidv7()),
        /** Deterministic idempotency key supplied by the caller; a duplicate intake is ignored. */
        dedupKey: text('dedup_key').notNull().unique(),
        recipient: text('recipient').notNull(),
        subject: text('subject').notNull(),
        body: text('body').notNull(),
        status: emailStatusEnum('status').notNull().default(EmailStatus.PENDING),
        /** Lease boundary: the email is claimable once `now()` passes this timestamp. */
        availableAt: timestamp('available_at').notNull().defaultNow(),
        ...timestamps,
    },
    (table) => [
        index('idx_email_claimable')
            .on(table.id)
            .where(sql.raw(`status in ('${EmailStatus.PENDING}', '${EmailStatus.PROCESSING}')`)),
    ],
);
