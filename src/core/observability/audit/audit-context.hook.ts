/**
 * @file audit-context.hook.ts
 * @description Fastify request hook opening the ambient audit context, before any guard can refuse
 * the request.
 */

import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { auditContextStorage } from 'src/core/observability/audit/audit-context';

/**
 * How much of `User-Agent` is kept. The header is attacker-controlled and unbounded, so an untrimmed
 * copy of it lands verbatim in a store that is exempt from log levels and cannot be pruned casually —
 * and it does so on exactly the requests there are most of, the refused ones. The cap keeps the
 * forensic value (which client family, browser vs script) and drops the padding.
 */
const USER_AGENT_MAX_LENGTH = 256;

/**
 * Establishes the audit context for the whole request and fills in what the transport already knows.
 *
 * This is a Fastify `onRequest` hook rather than a Nest interceptor, and the difference is the entire
 * point. Nest runs guards BEFORE interceptors, so a request refused by a guard — every `403` from the
 * roles guard — used to be recorded with no source IP, no user agent and no actor: an audit trail
 * saying that someone, somewhere, was refused. An `onRequest` hook runs ahead of the entire Nest
 * pipeline, so those refusals are now attributable to an address.
 *
 * It opens the context and fills the transport half only. The actor is added later by `AuthGuard`,
 * which is where a verified identity first exists — see {@link AuditContext}.
 *
 * It must also be a hook rather than a middleware: middleware receives the raw Node request, which has
 * no `ip` — the resolved client address, honouring the configured proxy trust, exists only on Fastify's
 * own request object. Re-deriving it from headers would mean re-implementing that trust decision, and
 * a second implementation is a second thing to get wrong.
 *
 * Calling `done` INSIDE `run` is what makes the store outlive this hook: the rest of the lifecycle is
 * invoked from that callback, so it inherits the context rather than starting outside it.
 *
 * The route is taken as Fastify's matched TEMPLATE (`/v1/user/:id`) rather than as `request.url`, and
 * that is a confidentiality decision, not a formatting one: a raw URL carries the query string, so any
 * endpoint that ever accepts a token or a search term in the query would write it verbatim into a
 * store that holds evidence and must never hold credentials. The template also has low cardinality,
 * which is what makes "how many refusals on this endpoint" answerable at all. It is empty on a request
 * that matched no route — where there is likewise no action to record.
 *
 * @param request The incoming request, read for its client address, user agent and matched route.
 * @param _reply The outgoing reply, untouched — this hook observes and never answers.
 * @param done Continues the request lifecycle, deliberately invoked within the ambient context.
 */
export function auditContextHook(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
    auditContextStorage.run(
        {
            sourceIp: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, USER_AGENT_MAX_LENGTH),
            method: request.method,
            route: request.routeOptions.url,
        },
        done,
    );
}
