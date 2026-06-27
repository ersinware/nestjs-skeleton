/**
 * @file cache-health-indicator.interface.ts
 * @description Interface defining the contract for verifying health check on cache databases.
 */

export interface ICacheHealthIndicator {
    /**
     * Sends a ping query to verify connection to both cache and state instances.
     *
     * @returns A promise that resolves on query success, or rejects if query fails.
     */
    ping(): Promise<void>;
}
