/**
 * @file timestamp-column.util.ts
 * @description Shared `createdAt`/`updatedAt` column sets for Drizzle schemas, split by who owns
 * `updatedAt`: the database or the domain.
 */

import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Timestamp columns for DB-owned tables mutated via `db.update()`: `.$onUpdate()` stamps `updatedAt`
 * on every `UPDATE`. It fires only when the set omits the column, so it never overrides an explicit
 * `updatedAt`. Aggregate root tables must use {@link aggregateTimestamps} instead.
 */
export const defaultTimestamps = {
    /**
     * When the record was created. Defaults to the current transaction time.
     */
    createdAt: timestamp('created_at').notNull().defaultNow(),

    /**
     * When the record was last updated. Stamped by the database on every `UPDATE`.
     */
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
};

/**
 * Timestamp columns for aggregate root tables, where the domain owns `updatedAt`: the aggregate
 * stamps it on every mutation and the writer persists it verbatim. `.$onUpdate()` is deliberately
 * omitted — it would never fire on the writer's `onConflictDoUpdate` path anyway.
 */
export const aggregateTimestamps = {
    /**
     * When the record was created. Defaults to the current transaction time.
     */
    createdAt: defaultTimestamps.createdAt,

    /**
     * When the record was last updated. Stamped by the aggregate, persisted verbatim by the writer.
     */
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
};
