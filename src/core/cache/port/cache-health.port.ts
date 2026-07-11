/**
 * @file cache-health-indicator.interface.ts
 * @description Interface defining the contract for verifying health check on cache databases.
 */

/**
 * Dependency injection token representing the cache health check indicator port.
 */
export const TOKEN_CACHE_HEALTH_PORT = Symbol('TOKEN_CACHE_HEALTH_PORT');

export interface ICacheHealthPort {
    /**
     * Sends a ping query to verify connection to both cache and state instances.
     *
     * @returns A promise that resolves on query success, or rejects if query fails.
     */
    ping(): Promise<void>;
}
