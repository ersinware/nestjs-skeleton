/**
 * @file handler.ts
 * @description Handles GetUserByIdQuery by fetching the user from the reader port. Caching is applied
 * by the query pipeline (see ICacheableQuery on the query), so this handler only reads and validates.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id/port';
import { TOKEN_GET_USER_BY_ID_PORT } from 'src/module/user/application/query/get-user-by-id/port';
import { GetUserByIdQuery, type GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the public user read-model by ID.
 */
@QueryHandler(GetUserByIdQuery)
export class GetUserByIdQueryHandler implements IQueryHandler<GetUserByIdQuery, GetUserByIdResult> {
    /**
     * Initializes the handler with the required port.
     *
     * @param getUserByIdPort The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_USER_BY_ID_PORT) private readonly getUserByIdPort: IGetUserByIdPort) {}

    /**
     * Executes the get user by ID query.
     *
     * @param query The query parameters containing the ID
     * @returns The user profile read model
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async execute(query: GetUserByIdQuery): Promise<GetUserByIdResult> {
        const user = await this.getUserByIdPort.getById(query.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        return user;
    }
}
