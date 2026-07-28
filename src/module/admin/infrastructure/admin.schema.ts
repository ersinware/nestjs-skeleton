/**
 * @file admin.schema.ts
 * @description Database table definition for the 'admins' entity using Drizzle ORM.
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
 * Drizzle ORM enum for admin roles.
 */
export const adminRoleEnum = adminSchema.enum('admin_role', [AdminRole.ADMIN, AdminRole.SUPER_ADMIN]);

/**
 * The Drizzle ORM table definition for the 'admins' table.
 */
export const admin = adminSchema.table(
    'admin',
    {
        /**
         * Primary key as UUID v7.
         */
        id: uuid('id').primaryKey().notNull(),

        /**
         * Email address associated with the admin account.
         * Enforced as globally unique at the database level.
         */
        email: text('email').notNull().unique(),

        /**
         * The full name of the admin.
         */
        name: text('name').notNull(),

        /**
         * The hashed password of the admin.
         */
        password: text('password').notNull(),

        /**
         * The role assigned to the admin account.
         */
        role: adminRoleEnum('role').notNull().default(AdminRole.ADMIN),

        /**
         * Flag indicating whether the admin account is banned.
         */
        isBanned: boolean('is_banned').notNull().default(false),

        /**
         * Timestamp indicating when the admin was soft-deleted.
         */
        deletedAt: timestamp('deleted_at'),

        /**
         * Monotonic session version. Any token minted with a lower version is rejected by the auth
         * guard, giving instant, DB-durable revocation. Incremented on ban and account deletion.
         */
        version: integer('version').notNull().default(0),

        ...aggregateTimestamps,
    },
    (table) => [
        index('admins_id_deleted_at_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);
