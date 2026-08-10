/**
 * @file user-cache-key.util.ts
 * @description Single source of the user module's cache key formats, shared by the caching and both invalidation paths.
 */

export const CacheKeys = {
    /**
     * The cache key of a single user's projection.
     *
     * @param id The unique identifier of the user
     * @returns The cache key
     */
    userById(id: string): string {
        return `user:${id}`;
    },
} as const;
