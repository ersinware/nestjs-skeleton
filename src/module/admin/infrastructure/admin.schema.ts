/**
 * @file admin.schema.ts
 * @description Drizzle schema of the admin bounded context: the `admin` PostgreSQL logical schema and its table.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { aggregateTimestamps } from 'src/core/database';
import { Permission } from 'src/shared/domain/principal';

/**
 * The PostgreSQL logical schema owned by the admin bounded context. Only this module may read or
 * write objects inside it.
 */
export const adminSchema = pgSchema('admin');

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
         * The Argon2-hashed password; null until the invited admin activates the account, which also
         * keeps a pending account unable to authenticate.
         */
        password: text('password'),

        /**
         * Identity shared by one invitation and its durable delivery attempts.
         */
        inviteId: uuid('invite_id'),

        /**
         * Fixed JWT issuance time; retries never change it.
         */
        inviteIssuedAt: timestamp('invite_issued_at'),

        /**
         * Fixed invitation deadline.
         */
        inviteExpiresAt: timestamp('invite_expires_at'),

        /**
         * Revocation snapshot prevents retries from reviving revoked invitations.
         */
        inviteRevocationVersion: integer('invite_revocation_version'),

        /**
         * The permissions the admin holds, as catalog values. A plain text array rather than a
         * PostgreSQL enum: the catalog lives in code, and removing a member from a PostgreSQL enum
         * is not supported, so the array keeps a catalog change a code-only change.
         */
        permissions: text('permissions').array().$type<readonly Permission[]>().notNull().default([]),

        /**
         * Whether the account is banned.
         */
        isBanned: boolean('is_banned').notNull().default(false),

        /**
         * Optimistic-lock version, incremented by every write. The writer updates only the row
         * still carrying the version it loaded, so a handler that decided on stale state is refused
         * instead of overwriting a concurrent ban, revocation or deletion.
         */
        version: integer('version').notNull().default(0),

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
         * be rotated; invite tokens must match it exactly. Re-invitation advances it.
         * A permission change leaves it, so the refresh token survives to fetch the new
         * permission set while the access tokens that carried the old one die.
         */
        revocationVersion: integer('revocation_version').notNull().default(0),

        ...aggregateTimestamps,
    },
    (table) => [
        check(
            'admin_invitation_check',
            sql`(
                (${table.inviteId} IS NULL AND ${table.inviteIssuedAt} IS NULL AND ${table.inviteExpiresAt} IS NULL AND ${table.inviteRevocationVersion} IS NULL)
                OR
                (${table.inviteId} IS NOT NULL AND ${table.inviteIssuedAt} IS NOT NULL AND ${table.inviteExpiresAt} IS NOT NULL AND ${table.inviteRevocationVersion} IS NOT NULL
                 AND ${table.password} IS NULL AND ${table.inviteExpiresAt} > ${table.inviteIssuedAt} AND ${table.inviteRevocationVersion} >= 0)
            )`,
        ),
        // Partial index over live rows: serves every `id = ? AND deleted_at IS NULL` lookup and the
        // listing's `ORDER BY id DESC` (UUID v7, so creation order) with no sort step. The email lookup
        // uses the `unique` index instead.
        index('admin_id_live_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
        // Exactly one root: a unique index over a constant, restricted to rows holding the root
        // marker, so a second row can never be inserted or updated into the tier — not even by hand.
        uniqueIndex('admin_root_unique_idx')
            .on(sql`(1)`)
            .where(sql`${sql.raw(`'${Permission.ADMIN_ROOT}'`)} = ANY(permissions)`),
    ],
);
