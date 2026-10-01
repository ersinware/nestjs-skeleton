/**
 * @file user.schema.ts
 * @description Drizzle schema of the user bounded context: the `user` PostgreSQL logical schema and its tables.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
         * Required avatar object key attached during registration.
         */
        avatarKey: text('avatar_key').notNull(),

        /**
         * Pending activation identity; cleared only by successful activation.
         */
        activationId: uuid('activation_id'),

        /**
         * Fixed activation deadline at whole-second precision.
         */
        activationExpiresAt: timestamp('activation_expires_at'),

        /**
         * Full revocation version captured when activation proof is issued.
         */
        activationRevocationVersion: integer('activation_revocation_version'),

        /**
         * Request identity shared with the confirmation delivery job.
         */
        pendingEmailRequestId: uuid('pending_email_request_id'),

        /**
         * Target address awaiting confirmation; not reserved by a unique constraint.
         */
        pendingEmail: text('pending_email'),

        /**
         * Fixed confirmation deadline at whole-second precision.
         */
        pendingEmailExpiresAt: timestamp('pending_email_expires_at'),

        /**
         * Full revocation version captured at request creation.
         */
        pendingEmailRevocationVersion: integer('pending_email_revocation_version'),

        /**
         * The permissions the user holds, as catalog values. A plain text array rather than a
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
         * be rotated. A permission change leaves it, so the refresh token survives to fetch the new
         * permission set while the access tokens that carried the old one die.
         */
        revocationVersion: integer('revocation_version').notNull().default(0),

        ...aggregateTimestamps,
    },
    (table) => [
        check(
            'user_activation_check',
            sql`((${table.activationId} IS NULL AND ${table.activationExpiresAt} IS NULL AND ${table.activationRevocationVersion} IS NULL) OR (${table.activationId} IS NOT NULL AND ${table.activationExpiresAt} IS NOT NULL AND ${table.activationRevocationVersion} IS NOT NULL AND ${table.activationRevocationVersion} >= 0))`,
        ),
        check(
            'user_pending_email_check',
            sql`((${table.pendingEmailRequestId} IS NULL AND ${table.pendingEmail} IS NULL AND ${table.pendingEmailExpiresAt} IS NULL AND ${table.pendingEmailRevocationVersion} IS NULL) OR (${table.pendingEmailRequestId} IS NOT NULL AND ${table.pendingEmail} IS NOT NULL AND ${table.pendingEmailExpiresAt} IS NOT NULL AND ${table.pendingEmailRevocationVersion} IS NOT NULL AND ${table.pendingEmailRevocationVersion} >= 0 AND ${table.activationId} IS NULL))`,
        ),
        // Partial index over live rows: serves every `id = ? AND deleted_at IS NULL` lookup and the
        // listing's `ORDER BY id DESC` (UUID v7, so creation order) with no sort step. The email lookup
        // uses the `unique` index instead.
        index('user_id_live_idx')
            .on(table.id)
            .where(sql`deleted_at IS NULL`),
    ],
);

/**
 * Immutable recipient evidence for a completed email change; retained independently of account lifecycle.
 */
export const emailChangeNotification = userSchema.table('email_change_notification', {
    /**
     * Handler-generated UUID v7, also used as the notification job delivery identity.
     */
    id: uuid('id').primaryKey().notNull(),

    /**
     * Owning account identifier retained with the notification record.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    /**
     * Address captured before the change; never resolved from the current account on retry.
     */
    previousEmail: text('previous_email').notNull(),

    /**
     * Time the email change completed.
     */
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
