/**
 * @file handler.ts
 * @description Handler for a single dead-letter job read.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    TOKEN_GET_DEAD_LETTER_JOB_PORT,
    type IGetDeadLetterJobPort,
} from 'src/module/job-queue-operations/application/query/get-dead-letter-job/port';
import {
    GetDeadLetterJobQuery,
    type GetDeadLetterJobResult,
} from 'src/module/job-queue-operations/application/query/get-dead-letter-job/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns a dead-letter job or reports that it is absent.
 */
@QueryHandler(GetDeadLetterJobQuery)
export class GetDeadLetterJobQueryHandler implements IQueryHandler<GetDeadLetterJobQuery, GetDeadLetterJobResult> {
    /**
     * Initializes the handler with its purpose-specific read port.
     *
     * @param port Dead-letter job lookup port
     */
    constructor(@Inject(TOKEN_GET_DEAD_LETTER_JOB_PORT) private readonly port: IGetDeadLetterJobPort) {}

    /**
     * Executes the job lookup.
     *
     * @param query Dead-letter job identifier
     * @returns Sanitized job
     * @throws {ResourceNotFoundException} When the job is absent from the shared queue
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job provenance, identifiers, or timestamps are invalid
     */
    async execute(query: GetDeadLetterJobQuery): Promise<GetDeadLetterJobResult> {
        const job = await this.port.getJob(query.id);

        if (!job) {
            throw new ResourceNotFoundException();
        }

        return job;
    }
}
