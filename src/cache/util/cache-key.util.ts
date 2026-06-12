/**
 * @file cache-key.util.ts
 * @description Utility defining dynamic prefix-based cache key formats for application entities.
 */

import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE } from 'src/common/constant/pagination.constant';

const PREFIX = 'app';

export const CacheKeys = {
    /**
     * Generates a cache key for a single user record.
     *
     * @param id The principal identifier.
     * @returns The cache key string.
     */
    userById(id: string): string {
        return `${PREFIX}:user:id:${id}`;
    },

    /**
     * Generates a cache key for a user list based on query parameters.
     *
     * @param query The pagination and search filters.
     * @returns The cache key string.
     */
    userList(query: { page?: number; limit?: number; search?: string }): string {
        return `${PREFIX}:user:list:page:${query.page || PAGINATION_DEFAULT_PAGE}:limit:${query.limit || PAGINATION_DEFAULT_LIMIT}:search:${query.search || ''}`;
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
