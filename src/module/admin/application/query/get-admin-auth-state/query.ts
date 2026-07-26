/**
 * @file query.ts
 * @description Query that resolves an admin's authentication state (active status + session version).
 */

import { Query } from '@nestjs/cqrs';
import type { ICacheableQuery } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/admin/application/admin-cache-key.util';
import { ADMIN_AUTH_STATE_CACHE_TTL_SECONDS } from 'src/module/admin/application/query/admin-cache.constant';

/**
 * Fetches the authentication state of an admin by their unique identifier. Cacheable: this read gates
 * every authenticated admin request, so it is served from cache under a short TTL and evicted by every
 * command/event that changes the admin's ban status or session version.
 */
export class GetAdminAuthStateQuery extends Query<GetAdminAuthStateResult> implements ICacheableQuery {
    /** Short TTL: the security backstop bounding staleness if an eviction is ever missed. */
    readonly cacheTtlSeconds = ADMIN_AUTH_STATE_CACHE_TTL_SECONDS;

    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache key for this admin's auth-state, shared with the invalidation side via CacheKeys.
     *
     * @returns The cache key for the requested admin id
     */
    cacheKey(): string {
        return CacheKeys.adminAuthState(this.id);
    }
}

/**
 * The expected result of the GetAdminAuthStateQuery: the account's ban status and current session
 * version, used together by token refresh to reject banned or superseded sessions.
 */
export type GetAdminAuthStateResult = {
    isBanned: boolean;
    version: number;
};
