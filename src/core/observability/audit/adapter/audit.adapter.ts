/**
 * @file audit.adapter.ts
 * @description Drizzle-backed implementation of the audit port, appending to the `audit.audit` table.
 */

import { Inject, Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, runOutsideDatabaseTransaction, translateConnectionFailure } from 'src/core/database';
import { getAuditContext, markExceptionAsAudited } from 'src/core/observability/audit/audit-context';
import { audit } from 'src/core/observability/audit/audit.schema';
import { AuditRecordInput, AuditRecordOptions, IAuditPort } from 'src/core/observability/audit/port/audit.port';
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
     * @param database The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Adds request context and records the audit entry in the current transaction, if any.
     * With `markExceptionAsAudited`, writes independently to survive rollback and marks the
     * exception only after commit.
     *
     * @param input What happened and to whom.
     * @param options Refusal exception marked only after its independent write commits.
     */
    async record(input: AuditRecordInput, options?: AuditRecordOptions) {
        if (options?.markExceptionAsAudited) {
            await runOutsideDatabaseTransaction(() => this.insert(input));
            markExceptionAsAudited(options.markExceptionAsAudited);

            return;
        }

        await this.insert(input);
    }

    /**
     * Appends evidence through the executor selected by the current database context.
     *
     * @param input Persistable facts supplied by the caller
     * @throws {DependencyUnavailableException} When the audit database is unavailable
     */
    private async insert(input: AuditRecordInput) {
        try {
            await this.database.insert(audit).values({
                ...getAuditContext(),
                ...input,
                traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
                occurredAt: new Date(),
                id: uuidv7(),
            });
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
