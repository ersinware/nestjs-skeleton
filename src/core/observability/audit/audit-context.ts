/**
 * @file audit-context.ts
 * @description The ambient identity and transport facts an audit record needs but its writer cannot see.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Who is acting and over which transport — request facts kept out of command payloads.
 *
 * The transport half is seeded by `auditContextHook` on arrival, ahead of every guard; the
 * identity half is mutable because it is published later, via {@link publishAuditActor}, once
 * `AuthenticationGuard` verifies a token. Identity is optional: a `@Public()` route has no actor.
 */
export type AuditContext = {
    /**
     * The client address resolved according to the trusted proxy configuration.
     */
    readonly remoteAddress: string;

    /**
     * The matched route template, or the request path without its query string.
     */
    readonly route: string;

    /**
     * The HTTP method of the request.
     */
    readonly method: string;

    /**
     * The client-supplied user agent, capped at the request hook.
     */
    readonly userAgent?: string;

    /**
     * The principal identifier added after authentication verifies the actor.
     */
    actorId?: string;

    /**
     * The actor's owning context, used to resolve the principal identifier.
     */
    actorType?: PrincipalType;
};

/**
 * Ambient storage for the current request's {@link AuditContext}.
 */
const auditContextStorage = new AsyncLocalStorage<{
    /**
     * Persistable request facts, kept separate from in-memory exception tracking.
     */
    readonly context: AuditContext;

    /**
     * Exceptions whose refusal evidence was durably accepted within this context.
     */
    readonly auditedExceptions: WeakSet<object>;
}>();

/**
 * Publishes a verified principal into the ambient context — the only way the identity half is
 * written. Only a VERIFIED identity may be published: a decoded-but-unverified token would forge
 * the trail. No-op outside an HTTP request.
 *
 * @param actorId The verified principal's identifier.
 * @param actorType The kind of the verified principal, so the id resolves to its owning context.
 */
export function publishAuditActor(actorId: string, actorType: PrincipalType) {
    const context = auditContextStorage.getStore()?.context;

    if (!context) {
        return;
    }

    context.actorId = actorId;
    context.actorType = actorType;
}

/**
 * Runs a callback inside its own audit context — used by `auditContextHook` to scope a request,
 * and by non-HTTP callers (cron, listener) to attribute records to a system identity.
 *
 * @param context The context records written inside the callback are completed from.
 * @param callback The work to run inside the context.
 * @returns Whatever the callback returns.
 */
export function runWithAuditContext<T>(context: AuditContext, callback: () => T): T {
    return auditContextStorage.run({ context, auditedExceptions: new WeakSet<object>() }, callback);
}

/**
 * Reads the current context for completing an audit entry.
 *
 * @returns The ambient context, or undefined when none was opened.
 */
export function getAuditContext(): Readonly<AuditContext> | undefined {
    return auditContextStorage.getStore()?.context;
}

/**
 * Marks an exception only after its refusal record has committed; no-op without a context.
 *
 * @param exception The same exception the handler will rethrow
 */
export function markExceptionAsAudited(exception: object) {
    auditContextStorage.getStore()?.auditedExceptions.add(exception);
}

/**
 * Checks whether this context already contains durable evidence for the caught exception.
 *
 * @param exception The caught value
 * @returns Whether this exact exception has been audited in the current context
 */
export function isExceptionAudited(exception: unknown): boolean {
    return (
        exception !== null &&
        typeof exception === 'object' &&
        (auditContextStorage.getStore()?.auditedExceptions.has(exception) ?? false)
    );
}
