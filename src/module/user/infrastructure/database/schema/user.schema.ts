/**
 * @file user.schema.ts
 * @description Database table definition for the 'users' entity using Drizzle ORM.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { aggregateTimestamps } from 'src/core/database';

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
         * Flag indicating whether the user account is banned.
         */
        isBanned: boolean('is_banned').notNull().default(false),

        /**
         * Timestamp indicating when the user was soft-deleted.
         */
        deletedAt: timestamp('deleted_at'),

        /**
         * Monotonic session version. Any token minted with a lower version is rejected by the auth
         * guard, giving instant, DB-durable revocation. Incremented on ban, password change, and
         * account deletion.
         */
        version: integer('version').notNull().default(0),

        ...aggregateTimestamps,
    },
    (table) => [
        index('users_id_deleted_at_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);
