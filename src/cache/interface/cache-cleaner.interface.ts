/**
 * @file cache-cleaner.interface.ts
 * @description Interface defining the contract for cache flushing operation.
 */

export interface ICacheCleaner {
    /**
     * Flushes all keys from the cache.
     *
     * @returns A promise resolving on execution success.
     */
    cleanup(): Promise<void>;
}
