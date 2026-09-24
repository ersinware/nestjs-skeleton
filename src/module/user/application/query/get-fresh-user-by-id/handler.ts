/**
 * @file handler.ts
 * @description Handles GetFreshUserByIdQuery through the primary reader port.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetFreshUserByIdPort } from 'src/module/user/application/query/get-fresh-user-by-id/port';
import { TOKEN_GET_FRESH_USER_BY_ID_PORT } from 'src/module/user/application/query/get-fresh-user-by-id/port';
import {
    GetFreshUserByIdQuery,
    type GetFreshUserByIdResult,
} from 'src/module/user/application/query/get-fresh-user-by-id/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the current public user read-model without caching.
 */
@QueryHandler(GetFreshUserByIdQuery)
export class GetFreshUserByIdQueryHandler implements IQueryHandler<GetFreshUserByIdQuery, GetFreshUserByIdResult> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_FRESH_USER_BY_ID_PORT) private readonly port: IGetFreshUserByIdPort) {}

    /**
     * Executes the get user by ID query.
     *
     * @param query The query parameters containing the ID
     * @returns The user profile read model
     * @throws {ResourceNotFoundException} When no non-deleted user exists with the given ID
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    async execute(query: GetFreshUserByIdQuery): Promise<GetFreshUserByIdResult> {
        const user = await this.port.getById(query.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        return user;
    }
}
