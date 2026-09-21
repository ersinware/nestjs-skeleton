/**
 * @file handler.ts
 * @description Handler for the dead-letter listing query.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    TOKEN_LIST_DEAD_LETTER_JOBS_PORT,
    type IListDeadLetterJobsPort,
} from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/port';
import {
    ListDeadLetterJobsQuery,
    type ListDeadLetterJobsResult,
} from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/query';

/**
 * Returns one bounded page of dead-letter jobs.
 */
@QueryHandler(ListDeadLetterJobsQuery)
export class ListDeadLetterJobsQueryHandler implements IQueryHandler<
    ListDeadLetterJobsQuery,
    ListDeadLetterJobsResult
> {
    /**
     * Initializes the handler with its purpose-specific read port.
     *
     * @param port Dead-letter listing port
     */
    constructor(@Inject(TOKEN_LIST_DEAD_LETTER_JOBS_PORT) private readonly port: IListDeadLetterJobsPort) {}

    /**
     * Executes the listing query.
     *
     * @param query Pagination request
     * @returns Sanitized page and count
     */
    async execute(query: ListDeadLetterJobsQuery): Promise<ListDeadLetterJobsResult> {
        return this.port.listJobs(query.params);
    }
}
