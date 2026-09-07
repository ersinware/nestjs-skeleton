/**
 * @file query.ts
 * @description Query that fetches one audit trail record by ID.
 */

import { Query } from '@nestjs/cqrs';
import { AuditAction } from 'src/core/observability/audit';
import { AuthRole } from 'src/shared/domain/auth-role';

/**
 * Fetches one audit trail record by ID.
 */
export class GetAuditTrailRecordByIdQuery extends Query<GetAuditTrailRecordByIdResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param id The ID of the record
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The full record read-model: every column, since all of it is evidence.
 */
export type GetAuditTrailRecordByIdResult = {
    id: string;
    action: AuditAction;
    reason: string | null;
    targetId: string | null;
    actorId: string | null;
    actorRole: AuthRole | null;
    remoteAddress: string | null;
    route: string | null;
    method: string | null;
    userAgent: string | null;
    traceId: string | null;
    occurredAt: Date;
};
