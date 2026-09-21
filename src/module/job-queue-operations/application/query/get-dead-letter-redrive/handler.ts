/**
 * @file handler.ts
 * @description Handler for one dead-letter redrive status read.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    TOKEN_GET_DEAD_LETTER_REDRIVE_PORT,
    type IGetDeadLetterRedrivePort,
} from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive/port';
import {
    GetDeadLetterRedriveQuery,
    type GetDeadLetterRedriveResult,
} from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the status of a retained redrive operation or reports its absence.
 */
@QueryHandler(GetDeadLetterRedriveQuery)
export class GetDeadLetterRedriveQueryHandler implements IQueryHandler<
    GetDeadLetterRedriveQuery,
    GetDeadLetterRedriveResult
> {
    /**
     * Initializes the handler with its purpose-specific read port.
     *
     * @param port Redrive operation lookup port
     */
    constructor(@Inject(TOKEN_GET_DEAD_LETTER_REDRIVE_PORT) private readonly port: IGetDeadLetterRedrivePort) {}

    /**
     * Loads one sanitized operation status.
     *
     * @param query Operation identifier
     * @returns Current public lifecycle view
     * @throws {ResourceNotFoundException} When the operation is absent or no longer retained
     */
    async execute(query: GetDeadLetterRedriveQuery): Promise<GetDeadLetterRedriveResult> {
        const operation = await this.port.getRedrive(query.operationId);

        if (!operation) {
            throw new ResourceNotFoundException();
        }

        return operation;
    }
}
