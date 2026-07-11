/**
 * @file cache-cleaner.port.ts
 * @description Interface defining the contract for cleaning cache databases.
 */

/**
 * Dependency injection token representing the cache cleaner port.
 */
export const TOKEN_CACHE_CLEANER_PORT = Symbol('TOKEN_CACHE_CLEANER_PORT');

export interface ICacheCleanerPort {
    /**
     * Flushes all keys from the cache and state.
     *
     * @returns A promise resolving on execution success.
     */
    cleanup(): Promise<void>;
}
