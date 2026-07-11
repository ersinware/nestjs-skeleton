/**
 * @file user.schema.ts
 * @description Database table definition for the 'users' entity using Drizzle ORM.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from 'src/core/database';

/**
 * The Drizzle ORM table definition for the 'users' table.
 */
export const user = pgTable(
    'user.user',
    {
        /**
         * Primary key as UUID v7.
         */
        id: uuid('id').primaryKey(),

        /**
         * Email address associated with the user account.
         * Enforced as globally unique at the database level.
         */
        email: text('email').notNull().unique(),

        /**
         * The full name of the user.
         */
        name: text('name').notNull(),

        /**
         * The hashed password of the user.
         */
        password: text('password').notNull(),

        /**
         * Flag indicating whether the user account is active.
         */
        isActive: boolean('is_active').notNull().default(true),

        /**
         * Timestamp indicating when the user was soft-deleted.
         */
        deletedAt: timestamp('deleted_at'),

        ...timestamps,
    },
    (table) => [
        index('users_id_deleted_at_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);
