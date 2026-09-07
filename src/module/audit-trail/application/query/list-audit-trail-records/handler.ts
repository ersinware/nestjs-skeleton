/**
 * @file handler.ts
 * @description Handler for ListAuditTrailRecordsQuery.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IListAuditTrailRecordsPort } from 'src/module/audit-trail/application/query/list-audit-trail-records/port';
import { TOKEN_LIST_AUDIT_TRAIL_RECORDS_PORT } from 'src/module/audit-trail/application/query/list-audit-trail-records/port';
import {
    ListAuditTrailRecordsQuery,
    type ListAuditTrailRecordsResult,
} from 'src/module/audit-trail/application/query/list-audit-trail-records/query';

/**
 * Returns a filtered, paginated page of audit trail records.
 */
@QueryHandler(ListAuditTrailRecordsQuery)
export class ListAuditTrailRecordsQueryHandler implements IQueryHandler<
    ListAuditTrailRecordsQuery,
    ListAuditTrailRecordsResult
> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_LIST_AUDIT_TRAIL_RECORDS_PORT) private readonly port: IListAuditTrailRecordsPort) {}

    /**
     * Executes the query.
     *
     * @param query The query carrying the filters and pagination parameters
     * @returns The page of records
     */
    async execute(query: ListAuditTrailRecordsQuery): Promise<ListAuditTrailRecordsResult> {
        return this.port.listRecords(query.params);
    }
}
