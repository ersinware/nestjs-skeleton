/**
 * @file cache-key.util.ts
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

    /**
     * Generates a cache key for a user's authentication state (ban status + session version). Keyed
     * separately from `userById` because auth guards read it on every request at a different cadence
     * and staleness tolerance than the public profile projection.
     *
     * @param id The principal identifier.
     * @returns The cache key string.
     */
    userAuthState(id: string): string {
        return `${PREFIX}:user-auth:${id}`;
    },
} as const;
