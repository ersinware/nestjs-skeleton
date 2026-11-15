/**
 * @file handler.ts
 * @description Handler for the retained redrive operation listing query.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    TOKEN_LIST_DEAD_LETTER_REDRIVES_PORT,
    type IListDeadLetterRedrivesPort,
} from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/port';
import {
    ListDeadLetterRedrivesQuery,
    type ListDeadLetterRedrivesResult,
} from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/query';

/**
 * Returns one bounded page of retained dead-letter redrives.
 */
@QueryHandler(ListDeadLetterRedrivesQuery)
export class ListDeadLetterRedrivesQueryHandler implements IQueryHandler<
    ListDeadLetterRedrivesQuery,
    ListDeadLetterRedrivesResult
> {
    /**
     * Initializes the handler with its purpose-specific read port.
     *
     * @param port Redrive listing port
     */
    constructor(
        @Inject(TOKEN_LIST_DEAD_LETTER_REDRIVES_PORT)
        private readonly port: IListDeadLetterRedrivesPort,
    ) {}

    /**
     * Executes the listing query.
     *
     * @param query Pagination request
     * @returns Sanitized page and total count
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job metadata or the returned page count is invalid
     */
    async execute(query: ListDeadLetterRedrivesQuery): Promise<ListDeadLetterRedrivesResult> {
        return this.port.listDeadLetterRedrives(query.params);
    }
}
