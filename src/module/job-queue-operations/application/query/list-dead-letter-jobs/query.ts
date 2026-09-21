/**
 * @file query.ts
 * @description Query for one page of sanitized dead-letter jobs.
 */

import { Query } from '@nestjs/cqrs';
import type { GetDeadLetterJobResult } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/query';
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
    readonly data: readonly GetDeadLetterJobResult[];

    /**
     * Total number of matching jobs across all pages.
     */
    readonly total: number;
};
