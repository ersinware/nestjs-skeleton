/**
 * @file handler.ts
 * @description Handles GetUserByIdQuery by fetching the user from the reader port.
 * Validates existence, throws an exception if the user is missing, and caches the result.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { ResourceNotFoundException } from 'src/core/exception';
import { USER_CACHE_TTL_SECONDS } from 'src/module/user/application/query/constant';
import type { IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id/port';
import { TOKEN_GET_USER_BY_ID_PORT } from 'src/module/user/application/query/get-user-by-id/port';
import { GetUserByIdQuery, type GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';
import { CacheKeys } from 'src/module/user/application/util';

/**
 * Returns the public user read-model by ID.
 */
@QueryHandler(GetUserByIdQuery)
export class GetUserByIdQueryHandler implements IQueryHandler<GetUserByIdQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param getUserByIdPort The port used to execute the query
     * @param cachePort The caching service
     */
    constructor(
        @Inject(TOKEN_GET_USER_BY_ID_PORT) private readonly getUserByIdPort: IGetUserByIdPort,
        @Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort,
    ) {}

    /**
     * Executes the get user by ID query.
     *
     * @param query The query parameters containing the ID
     * @returns The user profile read model
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async execute(query: GetUserByIdQuery): Promise<GetUserByIdResult> {
        const cacheKey = CacheKeys.userById(query.id),
            cached = await this.cachePort.get<GetUserByIdResult>(cacheKey);

        if (cached) {
            return cached;
        }

        const user = await this.getUserByIdPort.getById(query.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        void this.cachePort.set(cacheKey, user, USER_CACHE_TTL_SECONDS, { useJitter: true });

        return user;
    }
}
