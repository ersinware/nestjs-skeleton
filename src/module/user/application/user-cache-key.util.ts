/**
 * @file user-cache-key.util.ts
 * @description Utility defining dynamic prefix-based cache key formats for application entities.
 */

const PREFIX = 'app';

export const CacheKeys = {
    /**
     * Generates a cache key for a single user record.
     *
     * @param id The principal identifier.
     * @returns The cache key string.
     */
    userById(id: string): string {
        return `${PREFIX}:user:${id}`;
    },
} as const;
