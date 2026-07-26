/**
 * @file query.ts
 * @description Query that resolves the public read-model for a user by their unique identifier.
 * Opts into the read cache via ICacheableQuery, so the query pipeline serves and populates it.
 */

import { Query } from '@nestjs/cqrs';
import type { ICacheableQuery } from 'src/core/cqrs';
import { USER_CACHE_TTL_SECONDS } from 'src/module/user/application/query/user-cache.constant';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Fetches the public user projection by unique identifier. Cacheable: its result is keyed by user id
 * and served from cache by the query pipeline until the owning user's mutation evicts it.
 */
export class GetUserByIdQuery extends Query<GetUserByIdResult> implements ICacheableQuery {
    /** Time-to-live for the cached projection; a safety net bounding staleness if an eviction is missed. */
    readonly cacheTtlSeconds = USER_CACHE_TTL_SECONDS;

    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache key for this user's projection, shared with the invalidation side via CacheKeys.
     *
     * @returns The cache key for the requested user id
     */
    cacheKey(): string {
        return CacheKeys.userById(this.id);
    }
}

/**
 * The expected result of the GetUserByIdQuery, returning the read model.
 * Does not expose sensitive fields such as the hashed password.
 */
export type GetUserByIdResult = {
    id: string;
    email: string;
    name: string;
    isBanned: boolean;
    createdAt: Date;
    updatedAt: Date;
};
