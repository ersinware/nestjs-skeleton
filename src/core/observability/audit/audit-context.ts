/**
 * @file audit-context.ts
 * @description The ambient identity and transport facts an audit record needs but its writer cannot see.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthRole } from 'src/core/security/auth';

/**
 * Who is acting and over which transport, carried alongside the call rather than through it.
 *
 * These are facts about the REQUEST, not about the use case. Threading them through command
 * payloads would teach `BanUserCommand` about user agents and IP addresses — the exact inversion
 * the hexagonal boundary exists to prevent — and would have to be repeated by hand on every new
 * command. Ambient storage keeps the handler's contract about meaning alone: it supplies the
 * action, the adapter supplies the actor.
 *
 * Every field is optional because none is knowable on every path: a `@Public()` login route has no
 * authenticated actor yet, and a record written outside a request has no transport at all.
 */
export type AuditContext = {
    readonly actorId?: string | undefined;
    readonly actorRole?: AuthRole | undefined;
    readonly sourceIp?: string | undefined;
    readonly userAgent?: string | undefined;
};

/**
 * Ambient storage for the current request's {@link AuditContext}.
 *
 * Only an HTTP request populates it today, because every action currently worth auditing is
 * HTTP-triggered. That is an assumption, not a guarantee: a cron job or a listener resumed outside
 * the request's async chain finds an empty store, and its record is written WITHOUT an actor. The
 * record itself is never lost — the handler writes it either way — so the failure mode is a known
 * gap in attribution, not a missing entry. A future non-HTTP caller closes it by seeding its own
 * context with `run()` under a system identity.
 */
export const auditContextStorage = new AsyncLocalStorage<AuditContext>();
