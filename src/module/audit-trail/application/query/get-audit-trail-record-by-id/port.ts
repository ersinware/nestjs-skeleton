/**
 * @file port.ts
 * @description Outbound port for GetAuditTrailRecordByIdQuery.
 */

import type { GetAuditTrailRecordByIdResult } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/query';

/**
 * Dependency injection token representing the {@link IGetAuditTrailRecordByIdPort} contract.
 */
export const TOKEN_GET_AUDIT_TRAIL_RECORD_BY_ID_PORT = Symbol();

/**
 * Thin read contract for fetching one audit trail record by ID.
 */
export interface IGetAuditTrailRecordByIdPort {
    /**
     * Retrieves one audit trail record by ID.
     *
     * @param id The ID of the record
     * @returns The record, or null when none exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getById(id: string): Promise<GetAuditTrailRecordByIdResult | null>;
}
