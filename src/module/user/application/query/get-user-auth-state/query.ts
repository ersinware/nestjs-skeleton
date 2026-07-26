/**
 * @file query.ts
 * @description Query that resolves a user's authentication state (active status + session version).
 */

import { Query } from '@nestjs/cqrs';
import type { ICacheableQuery } from 'src/core/cqrs';
import { USER_AUTH_STATE_CACHE_TTL_SECONDS } from 'src/module/user/application/query/user-cache.constant';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Fetches the authentication state of a user by their unique identifier. Cacheable: this read gates
 * every authenticated request, so it is served from cache under a short TTL and evicted by every
 * command/event that changes the user's ban status or session version.
 */
export class GetUserAuthStateQuery extends Query<GetUserAuthStateResult> implements ICacheableQuery {
    /** Short TTL: the security backstop bounding staleness if an eviction is ever missed. */
    readonly cacheTtlSeconds = USER_AUTH_STATE_CACHE_TTL_SECONDS;

    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache key for this user's auth-state, shared with the invalidation side via CacheKeys.
     *
     * @returns The cache key for the requested user id
     */
    cacheKey(): string {
        return CacheKeys.userAuthState(this.id);
    }
}

/**
 * The expected result of the GetUserAuthStateQuery: the account's ban status and current session
 * version, used together by token refresh to reject banned or superseded sessions.
 */
export type GetUserAuthStateResult = {
    isBanned: boolean;
    version: number;
};
