/**
 * @file handler.ts
 * @description Handles CheckUserIsActiveQuery by fetching only the isActive field required.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { ICheckUserIsActivePort } from 'src/module/user/application/query/check-user-is-active/port';
import { TOKEN_CHECK_USER_IS_ACTIVE_PORT } from 'src/module/user/application/query/check-user-is-active/port';
import {
    CheckUserIsActiveQuery,
    CheckUserIsActiveResult,
} from 'src/module/user/application/query/check-user-is-active/query';

/**
 * Returns only the boolean active status for a user by ID.
 */
@QueryHandler(CheckUserIsActiveQuery)
export class CheckUserIsActiveQueryHandler implements IQueryHandler<CheckUserIsActiveQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_CHECK_USER_IS_ACTIVE_PORT) private readonly port: ICheckUserIsActivePort) {}

    /**
     * Executes the check user is active query.
     *
     * @param query The query parameters
     * @returns True if the user is active, false otherwise
     * @throws {ResourceNotFoundException} When no user exists with the given ID
     */
    async execute(query: CheckUserIsActiveQuery): Promise<CheckUserIsActiveResult> {
        const isActive = await this.port.checkIsActive(query.id);

        if (isActive === null) {
            throw new ResourceNotFoundException();
        }

        return isActive;
    }
}
