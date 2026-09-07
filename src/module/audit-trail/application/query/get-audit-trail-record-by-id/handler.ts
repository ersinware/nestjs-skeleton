/**
 * @file handler.ts
 * @description Handler for GetAuditTrailRecordByIdQuery.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetAuditTrailRecordByIdPort } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/port';
import { TOKEN_GET_AUDIT_TRAIL_RECORD_BY_ID_PORT } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/port';
import {
    GetAuditTrailRecordByIdQuery,
    type GetAuditTrailRecordByIdResult,
} from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns one audit trail record by ID.
 */
@QueryHandler(GetAuditTrailRecordByIdQuery)
export class GetAuditTrailRecordByIdQueryHandler implements IQueryHandler<
    GetAuditTrailRecordByIdQuery,
    GetAuditTrailRecordByIdResult
> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_AUDIT_TRAIL_RECORD_BY_ID_PORT) private readonly port: IGetAuditTrailRecordByIdPort) {}

    /**
     * Executes the query.
     *
     * @param query The query carrying the record ID
     * @returns The audit trail record
     * @throws {ResourceNotFoundException} When no record exists with the given ID
     */
    async execute(query: GetAuditTrailRecordByIdQuery): Promise<GetAuditTrailRecordByIdResult> {
        const record = await this.port.getById(query.id);

        if (!record) {
            throw new ResourceNotFoundException();
        }

        return record;
    }
}
