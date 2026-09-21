/**
 * @file query.ts
 * @description Query for one sanitized dead-letter job.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Retrieves one dead-letter job by its pg-boss identifier.
 */
export class GetDeadLetterJobQuery extends Query<GetDeadLetterJobResult> {
    /**
     * Initializes the query with the dead-letter job identifier.
     *
     * @param id Dead-letter job identifier
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * Sanitized metadata for one dead-letter job.
 */
export type GetDeadLetterJobResult = {
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
};
