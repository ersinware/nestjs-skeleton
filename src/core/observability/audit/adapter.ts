/**
 * @file adapter.ts
 * @description Pino-backed implementation of the audit port, writing through its own level-pinned
 * child logger so no operational logging decision can silence an audit record.
 */

import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { PinoLogger } from 'nestjs-pino';
import { auditContextStorage } from 'src/core/observability/audit/audit-context';
import { AuditEntry, AuditRecordInput } from 'src/core/observability/audit/audit-entry';
import { IAuditPort } from 'src/core/observability/audit/port';

/**
 * Marks the record as an audit entry in the log stream. Audit and operational lines share a
 * destination today, so a single indexed field is what keeps the two queryable apart — and what
 * lets a retention rule select the audit lines without pattern-matching their contents.
 */
const AUDIT_RECORD_TYPE = 'AUDIT';

/**
 * The level every audit entry is written at, pinned rather than configurable. An audit record is
 * not a severity — it is a fact that must be written — so the only reason it carries a level at all
 * is that the current destination demands one.
 */
const AUDIT_LEVEL = 'info';

/**
 * Writes audit entries to the log stream.
 *
 * The destination is pino only for now; the port exists precisely so a table can replace it later
 * without any caller changing. Two properties of this class are load-bearing rather than
 * incidental:
 *
 * - It writes through a child logger whose level it pins itself, so it is subject neither to the
 *   configured log level nor to the `NODE_ENV=test` silencing. Both are legitimate operational
 *   decisions about operational logs, and either would otherwise erase the audit trail as a side
 *   effect — under `test` it does so today. Pinning the level is what makes "this action produces an
 *   audit entry" assertable in an E2E test at all.
 * - The child is taken from the request-scoped logger rather than from the root, so an entry
 *   inherits the request's own bindings and correlates with the operational lines around it.
 * - It reads `traceId` from the active span EXPLICITLY, even though `instrumentation-pino` injects
 *   it today. That injection is a property of the current destination, and the correlation id has
 *   to survive the move to a table — so the entry carries it as data of its own.
 */
@Injectable()
export class AuditAdapter implements IAuditPort {
    /**
     * Creates an instance of AuditAdapter.
     *
     * @param pino The request-scoped-aware pino logger provided by nestjs-pino.
     */
    constructor(private readonly pino: PinoLogger) {}

    /**
     * Completes the caller's input into a full entry and writes it.
     *
     * The identity and transport fields of {@link AuditEntry} come from ambient storage rather than
     * from the caller, so a handler never has to know — or be able to state — who the actor was.
     * Outside a request the store is empty and those fields are simply absent; the entry is still
     * written, because an unattributed record is worth more than none.
     *
     * The context is spread BEFORE the caller's input so it can never overwrite it: `actorId` and
     * `targetId` are different facts, and an ambient value silently replacing a stated one would be
     * a forged record rather than a merge conflict.
     *
     * The child logger is derived per call because the logger it derives from is request-scoped:
     * memoizing it would pin every later entry to the first request's bindings.
     *
     * @param input The meaning of the event, supplied by whoever established the fact.
     */
    record(input: AuditRecordInput) {
        const entry: AuditEntry = {
            ...auditContextStorage.getStore(),
            ...input,
            occurredAt: new Date(),
            traceId: trace.getActiveSpan()?.spanContext().traceId,
        };

        // The action doubles as the message so an entry is identifiable by `msg` alone, exactly as
        // every other line in the stream is — the same reason `LogPayload` reserves `message`.
        this.pino.logger.child({}, { level: AUDIT_LEVEL }).info({ ...entry, type: AUDIT_RECORD_TYPE }, entry.action);
    }
}
