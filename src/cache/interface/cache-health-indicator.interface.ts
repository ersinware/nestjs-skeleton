/**
 * @file cache-health-indicator.interface.ts
 * @description Interface defining the contract for verifying cache connectivity status.
 */

export interface ICacheHealthIndicator {
    /**
     * Sends a ping query to verify connection to the cache.
     *
     * @returns A promise that resolves on query success, or rejects if query fails.
     */
    ping(): Promise<void>;
}
