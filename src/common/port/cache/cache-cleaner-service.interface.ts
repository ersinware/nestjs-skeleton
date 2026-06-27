/**
 * @file cache-cleaner-service.interface.ts
 * @description Interface defining the contract for cleaning cache databases.
 */

export interface ICacheCleanerService {
    /**
     * Flushes all keys from the cache and state.
     *
     * @returns A promise resolving on execution success.
     */
    cleanup(): Promise<void>;
}
