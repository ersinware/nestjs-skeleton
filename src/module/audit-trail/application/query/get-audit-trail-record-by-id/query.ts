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
    /**
     * Identifier of the audit record.
     */
    readonly id: string;

    /**
     * Recorded action and outcome.
     */
    readonly action: AuditAction;

    /**
     * Internal refusal reason when the action was rejected.
     */
    readonly reason: string | null;

    /**
     * Structured identifiers describing what changed, when present.
     */
    readonly detail: AuditDetail | null;

    /**
     * Identifier of the subject affected by the action, when known.
     */
    readonly targetId: string | null;

    /**
     * Identifier of the principal who performed the action, when known.
     */
    readonly actorId: string | null;

    /**
     * Principal kind of the actor, when known.
     */
    readonly actorType: PrincipalType | null;

    /**
     * Recorded network address of the caller, when available.
     */
    readonly remoteAddress: string | null;

    /**
     * Matched route template, when available.
     */
    readonly route: string | null;

    /**
     * HTTP method of the request, when available.
     */
    readonly method: string | null;

    /**
     * Recorded user agent, when available.
     */
    readonly userAgent: string | null;

    /**
     * Trace identifier linking the record to diagnostics, when available.
     */
    readonly traceId: string | null;

    /**
     * Time the action was recorded.
     */
    readonly occurredAt: Date;
};
