/**
 * @file query.ts
 * @description Query that fetches one audit trail record by ID.
 */

import { Query } from '@nestjs/cqrs';
import { AuditAction, type AuditDetail } from 'src/core/observability/audit';
import type { PrincipalType } from 'src/shared/domain/principal';

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
    readonly id: string;
    readonly action: AuditAction;
    readonly reason: string | null;
    readonly detail: AuditDetail | null;
    readonly targetId: string | null;
    readonly actorId: string | null;
    readonly actorType: PrincipalType | null;
    readonly remoteAddress: string | null;
    readonly route: string | null;
    readonly method: string | null;
    readonly userAgent: string | null;
    readonly traceId: string | null;
    readonly occurredAt: Date;
};
