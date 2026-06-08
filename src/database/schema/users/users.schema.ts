/**
 * @file users.schema.ts
 * @description Database table definition for the 'users' entity using Drizzle ORM.
 */

import { boolean, pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { sql } from 'drizzle-orm';
import { timestamps } from '../base.schema';

/**
 * The Drizzle ORM table definition for the 'users' table.
 */
export const users = pgTable(
    'users',
    {
        /**
         * Primary key as UUID v7.
         */
        id: uuid('id')
            .primaryKey()
            .$defaultFn(() => uuidv7()),

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
    (table) => ({
        idDeletedAtIdx: index('users_id_deleted_at_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    }),
);
