/**
 * @file audit-entry.ts
 * @description The audit record split into the part a caller supplies and the part the adapter derives.
 */

import { AuditAction } from 'src/core/observability/audit/audit-action.enum';

/**
 * What the caller of the audit port supplies — the MEANING of the event and nothing else.
 *
 * A handler knows which action happened and to whom it applied; it does not know the caller's IP,
 * user agent or trace, and must not learn them: a command handler reaching for transport data would
 * invert the dependency direction the architecture exists to protect. Everything absent here is
 * filled in by the adapter, which is the only place that knows.
 *
 * There is deliberately no success/failure field. Every member of the closed {@link AuditAction}
 * list already states its own outcome — a handler records a privileged action only after the write
 * succeeded, and `LOGIN_FAILED` or `ACCESS_DENIED` is a refusal by name — so a separate field would
 * restate the action and, worse, be able to contradict it.
 *
 * `reason` carries WHY a refusal happened and is meaningless on an action that cannot fail.
 */
export type AuditRecordInput = {
    readonly action: AuditAction;
    readonly reason?: string | undefined;
    /** The subject the action was applied to — not necessarily the actor who applied it. */
    readonly targetId?: string | undefined;
};

/**
 * The complete record as written, produced by the adapter from the caller's input.
 *
 * The identity and transport fields are all optional because none of them is knowable on every
 * path: a `@Public()` route has no authenticated actor, and a record written outside an HTTP
 * request has no IP or user agent at all. An absent field means "not knowable here", never
 * "not recorded".
 */
export type AuditEntry = AuditRecordInput & {
    /** Server clock, UTC. Never taken from the client. */
    readonly occurredAt: Date;
    readonly actorId?: string | undefined;
    readonly actorRole?: string | undefined;
    readonly sourceIp?: string | undefined;
    readonly userAgent?: string | undefined;
    readonly traceId?: string | undefined;
};
