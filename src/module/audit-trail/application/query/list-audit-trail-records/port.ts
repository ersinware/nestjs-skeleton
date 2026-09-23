/**
 * @file port.ts
 * @description Outbound port for ListAuditTrailRecordsQuery.
 */

import type {
    AuditTrailFilterParams,
    ListAuditTrailRecordsResult,
} from 'src/module/audit-trail/application/query/list-audit-trail-records/query';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Dependency injection token representing the {@link IListAuditTrailRecordsPort} contract.
 */
export const TOKEN_LIST_AUDIT_TRAIL_RECORDS_PORT = Symbol();

/**
 * Thin read contract for listing audit trail records with filters and pagination.
 */
export interface IListAuditTrailRecordsPort {
    /**
     * Reads one newest-first page of audit trail records matching the filters.
     *
     * @param params The filters and pagination parameters
     * @returns The page of records plus the total row count matching the filters
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    listRecords(params: AuditTrailFilterParams & PaginationParams): Promise<ListAuditTrailRecordsResult>;
}
