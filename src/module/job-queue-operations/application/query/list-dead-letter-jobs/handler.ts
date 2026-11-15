/**
 * @file handler.ts
 * @description Handler for the dead-letter listing query.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT, type IJobQueueDeadLetterReaderPort } from 'src/core/job-queue';
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
     * Initializes the handler with the shared dead-letter read port.
     *
     * @param port Dead-letter reader port
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT) private readonly port: IJobQueueDeadLetterReaderPort,
    ) {}

    /**
     * Executes the listing query.
     *
     * @param query Pagination request
     * @returns Sanitized page and count
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job metadata or the returned page count is invalid
     */
    async execute(query: ListDeadLetterJobsQuery): Promise<ListDeadLetterJobsResult> {
        return this.port.listDeadLetterJobs(query.params);
    }
}
