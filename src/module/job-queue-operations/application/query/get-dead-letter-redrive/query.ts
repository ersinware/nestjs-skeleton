/**
 * @file query.ts
 * @description Query for the retained status of one redrive operation.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Retrieves a redrive operation from the pg-boss orchestration queue.
 */
export class GetDeadLetterRedriveQuery extends Query<GetDeadLetterRedriveResult> {
    /**
     * Initializes the query with the operation identifier.
     *
     * @param operationId Redrive orchestration job identifier
     */
    constructor(readonly operationId: string) {
        super();
    }
}

/**
 * Public lifecycle states of a dead-letter redrive operation.
 */
export type DeadLetterRedriveStatus = 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Sanitized status of one retained redrive operation.
 */
export type GetDeadLetterRedriveResult = {
    /**
     * Identifier returned when redrive was requested.
     */
    readonly operationId: string;

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
};
