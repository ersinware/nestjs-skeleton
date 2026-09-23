/**
 * @file cache-health.port.ts
 * @description Contract for verifying the health of the cache connection.
 */

/**
 * Dependency injection token representing the {@link ICacheHealthPort} contract.
 */
export const TOKEN_CACHE_HEALTH_PORT = Symbol();

/**
 * Contract for probing the cache connection, consumed by the health indicators.
 */
export interface ICacheHealthPort {
    /**
     * Sends a ping to verify connection to the cache instance.
     *
     * @throws {Error} The raw driver error when the cache is unreachable.
     */
    ping(): Promise<void>;
}
