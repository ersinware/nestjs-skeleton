/**
 * @file admins.schema.ts
 * @description Database table definition for the 'admins' entity using Drizzle ORM.
 */

import { boolean, pgEnum, pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { timestamps } from '../base.schema';
import { AuthUserRole } from 'src/common/guard/enum/auth-user-role.enum';

export const adminRoleEnum = pgEnum('admin_role', [AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN]);

/**
 * The Drizzle ORM table definition for the 'admins' table.
 */
export const admins = pgTable('admins', {
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
});
