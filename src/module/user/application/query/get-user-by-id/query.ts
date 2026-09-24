/**
 * @file query.ts
 * @description Query that resolves the public read-model for a user by their unique identifier.
 * Opts into the read cache via ICacheableQuery, so the query pipeline serves and populates it.
 */

import { Query } from '@nestjs/cqrs';
import type { ICacheableQuery } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Fetches the public user projection by unique identifier. Cacheable: its result is keyed by user id
 * and served from cache by the query pipeline until the owning user's mutation evicts it.
 */
export class GetUserByIdQuery extends Query<GetUserByIdResult> implements ICacheableQuery {
    /**
     * Time-to-live of the cached projection.
     */
    readonly cacheTtlSeconds = 300;

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
 * The public user projection — the client-safe fields only, never the password hash.
 */
export type GetUserByIdResult = {
    /**
     * Identifier of the account represented by this row.
     */
    readonly id: string;

    /**
     * Current email address of the account.
     */
    readonly email: string;

    /**
     * Display name of the account.
     */
    readonly name: string;

    /**
     * Permissions currently assigned to the account.
     */
    readonly permissions: readonly Permission[];

    /**
     * Whether the account is barred from authentication.
     */
    readonly isBanned: boolean;
};
