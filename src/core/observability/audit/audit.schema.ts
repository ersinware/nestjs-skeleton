/**
 * @file audit.schema.ts
 * @description Drizzle schema of the audit concern: the `audit` PostgreSQL logical schema and its
 * append-only record table.
 */

import { index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AuditAction } from 'src/core/observability/audit/audit-action.enum';
import type { AuditDetail } from 'src/core/observability/audit/port/audit.port';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import type { PrincipalType } from 'src/shared/domain/principal';
import { uuidv7 } from 'uuidv7';

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
         * Primary key as UUID v7, so id order is time order. Generated here, not by the database:
         * `gen_random_uuid()` is v4 and would lose the ordering.
         */
        id: uuid('id')
            .primaryKey()
            .$defaultFn(() => uuidv7()),

        /**
         * What happened; each action states its own outcome.
         */
        action: text('action').$type<AuditAction | DomainFailureAuditAction>().notNull(),

        /**
         * Why a refusal happened; null on an action that cannot fail.
         */
        reason: text('reason'),

        /**
         * What the action changed, when the ids alone do not say (the permissions a change granted
         * and revoked); null on an action whose meaning the ids carry in full.
         */
        detail: jsonb('detail').$type<AuditDetail>(),

        /**
         * The subject the action was applied to; a soft link, never a foreign key.
         */
        targetId: uuid('target_id'),

        /**
         * The verified principal who acted; null on a public route or outside a request.
         */
        actorId: uuid('actor_id'),

        /**
         * The kind of the verified principal, so `actorId` resolves to its owning context without
         * probing every table.
         */
        actorType: text('actor_type').$type<PrincipalType>(),

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
        // Every index ends in `(occurred_at DESC, id DESC)`, the listing's exact ORDER BY, so a page is
        // read in index order with no sort step; `id` (UUID v7) breaks same-millisecond ties, keeping
        // page boundaries deterministic.

        // The unfiltered listing and the time-range filter.
        index('audit_occurred_at_idx').on(table.occurredAt.desc(), table.id.desc()),

        // One equality filter each; the leading column lands the planner on that slice already in
        // listing order. Combined filters use the most selective index and check the rest on the rows.
        index('audit_actor_idx').on(table.actorId, table.occurredAt.desc(), table.id.desc()),
        index('audit_target_idx').on(table.targetId, table.occurredAt.desc(), table.id.desc()),
        index('audit_action_idx').on(table.action, table.occurredAt.desc(), table.id.desc()),
    ],
);
