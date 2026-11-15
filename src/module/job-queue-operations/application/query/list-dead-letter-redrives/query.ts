/**
 * @file query.ts
 * @description Query for one page of retained dead-letter redrive operations.
 */

import { Query } from '@nestjs/cqrs';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Retrieves one newest-first page of retained dead-letter redrive operations.
 */
export class ListDeadLetterRedrivesQuery extends Query<ListDeadLetterRedrivesResult> {
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
 * Public lifecycle states of a dead-letter redrive operation.
 */
export type DeadLetterRedriveStatus = 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * One newest-first page of retained redrive operations and its total matching count.
 */
export type ListDeadLetterRedrivesResult = {
    /**
     * Operations in the requested page.
     */
    readonly data: readonly {
        /**
         * Identifier of the retained redrive operation.
         */
        readonly id: string;

        /**
         * Current orchestration lifecycle state.
         */
        readonly status: DeadLetterRedriveStatus;

        /**
         * Time the operator request was enqueued.
         */
        readonly createdOn: Date;

        /**
         * Terminal completion time when available.
         */
        readonly completedOn: Date | null;
    }[];

    /**
     * Total number of matching operations across all pages.
     */
    readonly total: number;
};
