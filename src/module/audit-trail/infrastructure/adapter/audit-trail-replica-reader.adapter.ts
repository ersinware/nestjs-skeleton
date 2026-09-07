/**
 * @file audit-trail-replica-reader.adapter.ts
 * @description Drizzle implementation of the audit trail query ports on the replica connection.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_REPLICA_CLIENT, translateConnectionFailure } from 'src/core/database';
import { audit } from 'src/core/observability/audit';
import type { IGetAuditTrailRecordByIdPort } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/port';
import type { GetAuditTrailRecordByIdResult } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/query';
import type { IListAuditTrailRecordsPort } from 'src/module/audit-trail/application/query/list-audit-trail-records/port';
import type {
    AuditTrailFilterParams,
    ListAuditTrailRecordsResult,
} from 'src/module/audit-trail/application/query/list-audit-trail-records/query';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Reads the core-owned `audit.audit` table on the replica: the operator view tolerates replication
 * lag, and the trail is append-only, so a lagging page is merely shorter, never wrong.
 */
@Injectable()
export class AuditTrailReplicaReaderAdapter implements IListAuditTrailRecordsPort, IGetAuditTrailRecordByIdPort {
    /**
     * @param db The Drizzle client on the replica connection
     */
    constructor(@Inject(TOKEN_DATABASE_REPLICA_CLIENT) private readonly db: NodePgDatabase) {}

    /**
     * Reads one newest-first page of record summaries. Every filter targets an indexed column and
     * the sort matches the index order, so the read never scans the trail.
     *
     * @param params The filters and pagination parameters
     * @returns The page of records plus the total row count matching the filters
     */
    async listRecords(params: AuditTrailFilterParams & PaginationParams): Promise<ListAuditTrailRecordsResult> {
        const conditions = and(
            ...(params.action ? [eq(audit.action, params.action)] : []),
            ...(params.actorId ? [eq(audit.actorId, params.actorId)] : []),
            ...(params.targetId ? [eq(audit.targetId, params.targetId)] : []),
            ...(params.from ? [gte(audit.occurredAt, params.from)] : []),
            ...(params.to ? [lte(audit.occurredAt, params.to)] : []),
        );

        try {
            const [data, countResult] = await Promise.all([
                this.db
                    .select({
                        id: audit.id,
                        action: audit.action,
                        targetId: audit.targetId,
                        actorId: audit.actorId,
                        occurredAt: audit.occurredAt,
                    })
                    .from(audit)
                    .where(conditions)
                    .orderBy(desc(audit.occurredAt), desc(audit.id))
                    .limit(params.limit)
                    .offset((params.page - 1) * params.limit),
                this.db.select({ total: count() }).from(audit).where(conditions),
            ]);

            return { data, total: countResult[0]?.total ?? 0 };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Retrieves one record by ID.
     *
     * @param id The ID of the record
     * @returns The record, or null when none exists
     */
    async getById(id: string): Promise<GetAuditTrailRecordByIdResult | null> {
        try {
            return (await this.db.select().from(audit).where(eq(audit.id, id)).limit(1))[0] ?? null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
