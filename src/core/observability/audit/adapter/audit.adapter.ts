/**
 * @file audit.adapter.ts
 * @description Drizzle-backed implementation of the audit port, appending to the `audit.audit` table.
 */

import { Inject, Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { getAuditContext } from 'src/core/observability/audit/audit-context';
import { audit } from 'src/core/observability/audit/audit.schema';
import { AuditRecordInput, IAuditPort } from 'src/core/observability/audit/port/audit.port';
import { uuidv7 } from 'uuidv7';

/**
 * Appends audit records on the primary connection. Never fail-open: a record that cannot be
 * written fails the caller.
 */
@Injectable()
export class AuditAdapter implements IAuditPort {
    /**
     * Creates an instance of AuditAdapter.
     *
     * @param db The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase) {}

    /**
     * Completes the input with the ambient audit context and inserts the row; outside a request
     * the row is unattributed. Id, time and context are fixed here so a deferred write would carry
     * the same fact. The context is spread BEFORE the input so an ambient value never overwrites a
     * stated one.
     *
     * @param input What happened and to whom.
     */
    async record(input: AuditRecordInput) {
        try {
            await this.db.insert(audit).values({
                id: uuidv7(),
                ...getAuditContext(),
                ...input,
                traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
                occurredAt: new Date(),
            });
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
