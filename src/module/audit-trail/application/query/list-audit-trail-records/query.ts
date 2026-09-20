/**
 * @file query.ts
 * @description Query that returns a filtered, paginated page of audit trail records.
 */

import { Query } from '@nestjs/cqrs';
import { AuditAction } from 'src/core/observability/audit';
import { PaginationParams } from 'src/shared/pagination';

/**
 * The optional filters of the listing. Every member maps onto an indexed column; a filter on a
 * non-indexed column would turn the read into a table scan.
 */
export type AuditTrailFilterParams = {
    /** Restricts the page to one action. */
    readonly action?: AuditAction;

    /** Restricts the page to the records written by one actor. */
    readonly actorId?: string;

    /** Restricts the page to the records about one subject. */
    readonly targetId?: string;

    /** The inclusive lower bound of `occurredAt`. */
    readonly from?: Date;

    /** The inclusive upper bound of `occurredAt`. */
    readonly to?: Date;
};

/**
 * Retrieves one newest-first page of the audit trail.
 */
export class ListAuditTrailRecordsQuery extends Query<ListAuditTrailRecordsResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param params The filters and pagination limits
     */
    constructor(readonly params: AuditTrailFilterParams & PaginationParams) {
        super();
    }
}

/**
 * One page of records plus the total row count matching the filters. A row carries only what
 * identifies the action (who did what to whom, and when); the rest belongs to the single-record read.
 */
export type ListAuditTrailRecordsResult = {
    readonly data: readonly {
        readonly id: string;
        readonly action: AuditAction;
        readonly route: string | null;
        readonly targetId: string | null;
        readonly actorId: string | null;
        readonly occurredAt: Date;
    }[];
    readonly total: number;
};
