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

/**
 * Appends audit records on the primary connection. Never fail-open: a record that cannot be
 * written fails the caller.
 */
@Injectable()
export class AuditAdapter implements IAuditPort {
    /**
     * Creates an instance of AuditAdapter.
     *
     * @param database The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Completes the input with the ambient audit context and inserts the row; outside a request
     * the row is unattributed. Time and context are fixed here (the id by the schema) so a
     * deferred write would carry the same fact. The context is spread BEFORE the input so an
     * ambient value never overwrites a stated one.
     *
     * @param input What happened and to whom.
     */
    async record(input: AuditRecordInput) {
        try {
            await this.database.insert(audit).values({
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
