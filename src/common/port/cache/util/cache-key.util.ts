/**
 * @file cache-key.util.ts
 * @description Utility defining dynamic prefix-based cache key formats for application entities.
 */

import { UserJoin } from 'src/api/v1/user/enum/user-join.enum';

const PREFIX = 'app';

export const CacheKeys = {
    /**
     * Generates a cache key for a single user record or its relational parts.
     *
     * @param id The principal identifier.
     * @param join Optional relation to cache separately (e.g. posts, profile).
     * @returns The cache key string.
     */
    userById(id: string, join?: UserJoin): string {
        return join ? `${PREFIX}:user:${id}:${join}` : `${PREFIX}:user:${id}`;
    },

    /**
     * Generates a cache key glob pattern for a specific user and all their relational parts.
     *
     * @param id The principal identifier.
     * @returns The glob pattern string.
     */
    userByIdPattern(id: string): string {
        return `${PREFIX}:user:${id}*`;
    },

    /**
     * Generates a cache key for a user list based on query parameters.
     *
     * @param query The pagination and search filters.
     * @returns The cache key string.
     */
    userList(query: { page: number; limit: number; search?: string }): string {
        return `${PREFIX}:user:list:page:${query.page}:limit:${query.limit}:search:${query.search || ''}`;
    },

    /**
     * Generates a cache key glob pattern for user list/search results.
     *
     * @returns The glob pattern string.
     */
    userListPattern(): string {
        return `${PREFIX}:user:list:*`;
    },
} as const;
