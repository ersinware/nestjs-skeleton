/**
 * @file idempotency.schema.ts
 * @description Core-owned PostgreSQL request identities and minimal replay metadata.
 */

import { index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Cross-cutting request coordination, independent of bounded-context business tables.
 */
export const idempotencySchema = pgSchema('idempotency');

/**
 * A visible row represents committed success; unsuccessful claims roll back with the mutation.
 */
export const operation = idempotencySchema.table(
    'operation',
    {
        /**
         * Global UUID v4 supplied by the client, shared across endpoints and principals.
         */
        key: uuid('key').primaryKey(),

        /**
         * Context-separated HMAC digest; raw request data and secrets are never stored.
         */
        fingerprint: text('fingerprint').notNull(),

        /**
         * Stable response identity when required, otherwise null.
         */
        replayResultId: uuid('replay_result_id'),

        /**
         * Transaction timestamp supporting future centralized retention cleanup.
         */
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (table) => [index('idempotency_operation_created_at_idx').on(table.createdAt)],
);
