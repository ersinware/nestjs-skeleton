/**
 * @file audit-context.hook.ts
 * @description Fastify request hook opening the ambient audit context, before any guard can refuse
 * the request.
 */

import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { runWithAuditContext } from 'src/core/observability/audit/audit-context';

/**
 * Establishes the audit context and fills in the transport half; the actor is added by `AuthenticationGuard`
 * once a verified identity exists — see {@link AuditContext}.
 *
 * A Fastify `onRequest` hook on purpose: only a hook runs ahead of guards, making a guard-raised
 * refusal attributable, and only Fastify's request carries the proxy-trust-resolved `ip`. `done`
 * is called INSIDE `run` so the rest of the lifecycle inherits the store.
 *
 * The route is Fastify's matched TEMPLATE (`/v1/user/:id`), never `request.url` — a raw URL may
 * carry tokens in its query string. When no route matched, the raw path stands in with the query
 * string stripped.
 *
 * @param request The incoming request, read for its client address, user agent and matched route.
 * @param _reply The outgoing reply, untouched.
 * @param done Continues the request lifecycle, invoked within the ambient context.
 */
export function auditContextHook(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
    runWithAuditContext(
        {
            remoteAddress: request.ip,
            route:
                request.routeOptions.url ??
                (() => {
                    const queryStart = request.url.indexOf('?');

                    return queryStart === -1 ? request.url : request.url.slice(0, queryStart);
                })(),
            method: request.method,
            ...(request.headers['user-agent'] && { userAgent: request.headers['user-agent']?.slice(0, 256) }),
        },
        done,
    );
}
