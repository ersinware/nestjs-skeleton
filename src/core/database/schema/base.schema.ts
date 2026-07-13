/**
 * @file base.schema.ts
 * @description Defines shared fields and helpers for Drizzle ORM schemas.
 * Includes auto-managed timestamps for creation and modification tracking.
 */

import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Timestamp columns for DB-owned ledger tables mutated via `db.update()` (e.g. outbox, email).
 * Here the database owns `updatedAt`: `.$onUpdate()` stamps it on every `UPDATE` statement. Note it
 * only fires when the column is absent from the set — it does NOT override an `onConflictDoUpdate` set
 * that already carries an explicit `updatedAt`. Aggregate root tables must use {@link aggregateTimestamps}.
 */
export const timestamps = {
    /**
     * Timestamp indicating when the record was created. Defaults to the current transaction time.
     */
    createdAt: timestamp('created_at').notNull().defaultNow(),

    /**
     * Timestamp indicating when the record was last updated. Automatically updates to the current time on record modification.
     */
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
};

/**
 * Timestamp columns for aggregate root tables where the domain owns `updatedAt` (e.g. admin, user).
 * The aggregate stamps `updatedAt` on every mutation and the writer's upsert persists it verbatim, so
 * `.$onUpdate()` is deliberately omitted — it would never fire on the `onConflictDoUpdate` path anyway,
 * and the session ban-version guard requires the persisted value to equal the in-memory aggregate's.
 */
export const aggregateTimestamps = {
    /**
     * Timestamp indicating when the record was created. Defaults to the current transaction time.
     */
    createdAt: timestamp('created_at').notNull().defaultNow(),

    /**
     * Timestamp indicating when the record was last updated. Owned by the domain: stamped by the
     * aggregate on mutation and persisted verbatim by the writer.
     */
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
};
