/**
 * @file handler.ts
 * @description Handler for one dead-letter redrive status read.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    TOKEN_GET_DEAD_LETTER_REDRIVE_STATUS_PORT,
    type IGetDeadLetterRedriveStatusPort,
} from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive-status/port';
import {
    GetDeadLetterRedriveStatusQuery,
    type GetDeadLetterRedriveStatusResult,
} from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive-status/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the status of a retained redrive operation or reports its absence.
 */
@QueryHandler(GetDeadLetterRedriveStatusQuery)
export class GetDeadLetterRedriveStatusQueryHandler implements IQueryHandler<
    GetDeadLetterRedriveStatusQuery,
    GetDeadLetterRedriveStatusResult
> {
    /**
     * Initializes the handler with its purpose-specific read port.
     *
     * @param port Redrive operation lookup port
     */
    constructor(
        @Inject(TOKEN_GET_DEAD_LETTER_REDRIVE_STATUS_PORT) private readonly port: IGetDeadLetterRedriveStatusPort,
    ) {}

    /**
     * Loads one sanitized operation status.
     *
     * @param query Operation identifier
     * @returns Current public lifecycle view
     * @throws {ResourceNotFoundException} When the operation is absent or no longer retained
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    async execute(query: GetDeadLetterRedriveStatusQuery): Promise<GetDeadLetterRedriveStatusResult> {
        const operation = await this.port.getRedriveStatus(query.operationId);

        if (!operation) {
            throw new ResourceNotFoundException();
        }

        return operation;
    }
}
