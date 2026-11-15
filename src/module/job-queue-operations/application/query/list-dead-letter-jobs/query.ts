/**
 * @file query.ts
 * @description Query for one page of sanitized dead-letter jobs.
 */

import { Query } from '@nestjs/cqrs';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Retrieves one newest-first page of dead-letter jobs.
 */
export class ListDeadLetterJobsQuery extends Query<ListDeadLetterJobsResult> {
    /**
     * Initializes the query with its pagination parameters.
     *
     * @param params Page and limit
     */
    constructor(readonly params: PaginationParams) {
        super();
    }
}

/**
 * One newest-first page of dead-letter jobs and its total matching count.
 */
export type ListDeadLetterJobsResult = {
    /**
     * Jobs in the requested page.
     */
    readonly data: readonly {
        /**
         * Dead-letter queue job identifier.
         */
        readonly id: string;

        /**
         * Time the dead-letter copy was created.
         */
        readonly createdOn: Date;

        /**
         * Queue on which the original job failed.
         */
        readonly sourceName: string;

        /**
         * Identifier of the original failed job.
         */
        readonly sourceId: string;

        /**
         * Time the original job was created.
         */
        readonly sourceCreatedOn: Date;

        /**
         * Retry count consumed by the original job.
         */
        readonly sourceRetryCount: number;

        /**
         * Logical delivery identifier of the original job.
         */
        readonly deliveryId: string;

        /**
         * Aggregate identifier of the original job.
         */
        readonly aggregateId: string;
    }[];

    /**
     * Total number of matching jobs across all pages.
     */
    readonly total: number;
};
