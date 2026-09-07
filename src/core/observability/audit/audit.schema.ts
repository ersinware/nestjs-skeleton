/**
 * @file audit.schema.ts
 * @description Drizzle schema of the audit concern: the `audit` PostgreSQL logical schema and its
 * append-only record table.
 */

import { index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AuditAction } from 'src/core/observability/audit/audit-action.enum';
import type { AuthRole } from 'src/shared/domain/auth-role';

/**
 * The PostgreSQL logical schema of the audit concern. Core owns it because audit is cross-cutting
 * evidence every module writes, not a bounded context's state.
 */
export const auditSchema = pgSchema('audit');

/**
 * The audit trail. Append-only, so no `updatedAt`/`deletedAt`. `action` is `text`, not a
 * PostgreSQL enum, so a new {@link AuditAction} member needs no migration.
 */
export const audit = auditSchema.table(
    'audit',
    {
        /**
         * Primary key as UUID v7, so id order is time order.
         */
        id: uuid('id').primaryKey(),

        /**
         * What happened; each action states its own outcome.
         */
        action: text('action').$type<AuditAction>().notNull(),

        /**
         * Why a refusal happened; null on an action that cannot fail.
         */
        reason: text('reason'),

        /**
         * The subject the action was applied to; a soft link, never a foreign key.
         */
        targetId: uuid('target_id'),

        /**
         * The verified principal who acted; null on a public route or outside a request.
         */
        actorId: uuid('actor_id'),

        /**
         * The verified principal's role at the time of the action.
         */
        actorRole: text('actor_role').$type<AuthRole>(),

        /**
         * The proxy-trust-resolved client address; null, like every transport fact, outside an
         * HTTP request (cron, listener).
         */
        remoteAddress: text('remote_address'),

        /**
         * Fastify's matched route TEMPLATE, never the raw URL.
         */
        route: text('route'),

        /**
         * The HTTP method of the request.
         */
        method: text('method'),

        /**
         * The client-supplied user agent, length-capped at the hook.
         */
        userAgent: text('user_agent'),

        /**
         * The active trace at write time, for correlation with the tracing backend.
         */
        traceId: text('trace_id'),

        /**
         * When the action happened. Stamped by the writer, never `defaultNow()`, so a deferred
         * write keeps the time of the fact.
         */
        occurredAt: timestamp('occurred_at').notNull(),
    },
    (table) => [
        index('audit_occurred_at_idx').on(table.occurredAt.desc(), table.id.desc()),
        index('audit_actor_idx').on(table.actorId, table.occurredAt.desc()),
        index('audit_target_idx').on(table.targetId, table.occurredAt.desc()),
        index('audit_action_idx').on(table.action, table.occurredAt.desc()),
    ],
);
