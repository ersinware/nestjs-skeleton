/**
 * @file user.schema.ts
 * @description Drizzle schema of the user bounded context: the `user` PostgreSQL logical schema and its table.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { aggregateTimestamps } from 'src/core/database';
import type { Permission } from 'src/shared/domain/principal';

/**
 * The PostgreSQL logical schema owned by the user bounded context. Only this module may read or
 * write objects inside it.
 */
export const userSchema = pgSchema('user');

/**
 * The user accounts table.
 */
export const user = userSchema.table(
    'user',
    {
        /**
         * Primary key as UUID v7.
         */
        id: uuid('id').primaryKey(),

        /**
         * Email address, unique at the database level.
         */
        email: text('email').notNull().unique(),

        /**
         * The full name of the user.
         */
        name: text('name').notNull(),

        /**
         * The Argon2-hashed password.
         */
        password: text('password').notNull(),

        /**
         * The permissions the user holds, as catalog values. A plain text array rather than a
         * PostgreSQL enum: the catalog lives in code, and removing a member from a PostgreSQL enum
         * is not supported, so the array keeps a catalog change a code-only change.
         */
        permissions: text('permissions').array().$type<Permission[]>().notNull().default([]),

        /**
         * Whether the account is banned.
         */
        isBanned: boolean('is_banned').notNull().default(false),

        /**
         * Soft-delete timestamp; null while the account is live.
         */
        deletedAt: timestamp('deleted_at'),

        /**
         * Monotonic session version: the version new tokens are minted at, and the floor an ACCESS
         * token must reach at the auth guard. Bumped by every cut-off — ban, deletion, password
         * change, session revocation, and a permission change.
         */
        sessionVersion: integer('session_version').notNull().default(0),

        /**
         * The session version of the last FULL revocation: the floor a REFRESH token must reach to
         * be rotated. A permission change leaves it, so the refresh token survives to fetch the new
         * permission set while the access tokens that carried the old one die.
         */
        revocationVersion: integer('revocation_version').notNull().default(0),

        ...aggregateTimestamps,
    },
    (table) => [
        // Partial index over live rows: serves every `id = ? AND deleted_at IS NULL` lookup and the
        // listing's `ORDER BY id DESC` (UUID v7, so creation order) with no sort step. The email lookup
        // uses the `unique` index instead.
        index('user_id_live_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);
