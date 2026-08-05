/**
 * @file audit.adapter.ts
 * @description Pino-backed implementation of the audit port.
 */

import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { PinoLogger } from 'nestjs-pino';
import { getAuditContext } from 'src/core/observability/audit/audit-context';
import { AuditRecordInput, IAuditPort } from 'src/core/observability/audit/port/audit.port';

/**
 * Pino-backed audit writer. Writes through a child logger with a pinned level, so neither the
 * configured log level nor `NODE_ENV=test` silencing can drop a record; reads `traceId` from the
 * active span itself so correlation survives a non-pino destination.
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
     * Completes the input with the ambient audit context and writes the entry; outside a request
     * the entry is unattributed. The context is spread BEFORE the input so an ambient value never
     * overwrites a stated one. The child logger is derived per call — the source logger is
     * request-scoped, so memoizing would pin later entries to the first request's bindings.
     *
     * @param input What happened and to whom.
     */
    record(input: AuditRecordInput) {
        this.pino.logger.child({}, { level: 'info' }).info(
            {
                ...getAuditContext(),
                ...input,
                occurredAt: new Date(),
                traceId: trace.getActiveSpan()?.spanContext().traceId,
                type: 'AUDIT',
            },
            input.action,
        );
    }
}
