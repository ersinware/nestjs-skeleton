/**
 * @file admin.schema.ts
 * @description Database table definition for the 'admins' entity using Drizzle ORM.
 */

import { boolean, pgEnum, pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { sql } from 'drizzle-orm';
import { timestamps } from '../base.schema';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';

/**
 * Drizzle ORM enum for admin roles.
 */
export const adminRoleEnum = pgEnum('admin_role', [AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN]);

/**
 * The Drizzle ORM table definition for the 'admins' table.
 */
export const admin = pgTable(
    'admins',
    {
        /**
         * Primary key as UUID v7.
         */
        id: uuid('id')
            .primaryKey()
            .$defaultFn(() => uuidv7()),

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
        role: adminRoleEnum('role').notNull().default(AuthUserRole.ADMIN),

        /**
         * Flag indicating whether the admin account is active.
         */
        isActive: boolean('is_active').notNull().default(true),

        /**
         * Timestamp indicating when the admin was soft-deleted.
         */
        deletedAt: timestamp('deleted_at'),

        ...timestamps,
    },
    (table) => [
        index('admins_id_deleted_at_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);
