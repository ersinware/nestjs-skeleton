/**
 * @file admin-cache-key.util.ts
 * @description Utility defining dynamic prefix-based cache key formats for admin entities.
 */

const PREFIX = 'app';

export const CacheKeys = {
    /**
     * Generates a cache key for an admin's authentication state (ban status + session version). Keyed
     * per admin id; shared by the read side (GetAdminAuthStateQuery) and every invalidation path so
     * populate and eviction always address the same entry.
     *
     * @param id The principal identifier.
     * @returns The cache key string.
     */
    adminAuthState(id: string): string {
        return `${PREFIX}:admin-auth:${id}`;
    },
} as const;
