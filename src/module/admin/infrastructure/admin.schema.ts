/**
 * @file admin.schema.ts
 * @description Drizzle schema of the admin bounded context: the `admin` PostgreSQL logical schema and its table.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { aggregateTimestamps } from 'src/core/database';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * The PostgreSQL logical schema owned by the admin bounded context. Only this module may read or
 * write objects inside it.
 */
export const adminSchema = pgSchema('admin');

/**
 * PostgreSQL enum derived from AdminRole, so a new role reaches the database without a hand-edit here.
 */
export const adminRoleEnum = adminSchema.enum('admin_role', Object.values(AdminRole) as [AdminRole]);

/**
 * The admin accounts table.
 */
export const admin = adminSchema.table(
    'admin',
    {
        /**
         * Primary key as UUID v7.
         */
        id: uuid('id').primaryKey().notNull(),

        /**
         * Email address, unique at the database level.
         */
        email: text('email').notNull().unique(),

        /**
         * The full name of the admin.
         */
        name: text('name').notNull(),

        /**
         * The Argon2-hashed password.
         */
        password: text('password').notNull(),

        /**
         * The authorization role.
         */
        role: adminRoleEnum('role').notNull().default(AdminRole.ADMIN),

        /**
         * Whether the account is banned.
         */
        isBanned: boolean('is_banned').notNull().default(false),

        /**
         * Soft-delete timestamp; null while the account is live.
         */
        deletedAt: timestamp('deleted_at'),

        /**
         * Monotonic session version. Any token minted with a lower version is rejected by the auth
         * guard, giving DB-durable revocation. Bumped on ban, deletion, and session revocation.
         */
        version: integer('version').notNull().default(0),

        ...aggregateTimestamps,
    },
    (table) => [
        index('admin_id_live_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);
