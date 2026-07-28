/**
 * @file cache-cleaner.port.ts
 * @description Contract for resetting the cache between E2E test cycles.
 */

/**
 * Dependency injection token representing the cache cleaner port.
 */
export const TOKEN_CACHE_CLEANER_PORT = Symbol('TOKEN_CACHE_CLEANER_PORT');

/**
 * Contract for wiping the cache wholesale, so test cycles start from a clean slate.
 */
export interface ICacheCleanerPort {
    /**
     * Flushes all keys from the cache.
     *
     * @throws {Error} The raw driver error when the flush fails.
     */
    cleanup(): Promise<void>;
}
