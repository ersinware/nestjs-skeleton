/**
 * @file query.ts
 * @description Query that returns a filtered, paginated page of audit trail records.
 */

import { Query } from '@nestjs/cqrs';
import { PaginationParams } from 'src/shared/pagination';

/**
 * The optional filters of the listing. Every member maps onto an indexed column; a filter on a
 * non-indexed column would turn the read into a table scan.
 */
export type AuditTrailFilterParams = {
    /**
     * Restricts the page to one action.
     */
    readonly action?: string;

    /**
     * Restricts the page to the records written by one actor.
     */
    readonly actorId?: string;

    /**
     * Restricts the page to the records about one subject.
     */
    readonly targetId?: string;

    /**
     * The inclusive lower bound of `occurredAt`.
     */
    readonly from?: Date;

    /**
     * The inclusive upper bound of `occurredAt`.
     */
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
    /**
     * Audit records in the requested page.
     */
    readonly data: readonly {
        /**
         * Identifier of the audit record.
         */
        readonly id: string;

        /**
         * Recorded action and outcome.
         */
        readonly action: string;

        /**
         * Matched route template, when available.
         */
        readonly route: string | null;

        /**
         * Identifier of the subject affected by the action, when known.
         */
        readonly targetId: string | null;

        /**
         * Identifier of the principal who performed the action, when known.
         */
        readonly actorId: string | null;

        /**
         * Time the action was recorded.
         */
        readonly occurredAt: Date;
    }[];

    /**
     * Total records matching the filters across all pages.
     */
    readonly total: number;
};
