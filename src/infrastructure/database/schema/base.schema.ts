/**
 * @file base.schema.ts
 * @description Defines shared fields and helpers for Drizzle ORM schemas.
 * Includes auto-managed timestamps for creation and modification tracking.
 */

import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Reusable timestamps object containing auto-populating createdAt and updatedAt timestamp columns.
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
