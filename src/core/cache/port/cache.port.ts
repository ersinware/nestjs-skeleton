/**
 * @file cache.port.ts
 * @description Contract for application caching operations.
 */

/**
 * Dependency injection token representing the cache operations port.
 */
export const TOKEN_CACHE_PORT = Symbol('TOKEN_CACHE_PORT');

/**
 * Contract for cache reads, writes, and evictions. Implementations fail open: a backend failure
 * degrades to a cache miss, so callers never handle cache errors.
 */
export interface ICachePort {
    /**
     * Sets a key's value in the cache, serializing non-string values to JSON.
     *
     * @param key Cache key.
     * @param value Cache value.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @param options.useJitter Adds random variation to the TTL, spreading expirations to avoid stampedes.
     * @param options.jitterMaxPercent Maximum percentage of the TTL to add as jitter.
     * @returns A promise resolving on execution success.
     */
    set(
        key: string,
        value: unknown,
        ttlSeconds?: number,
        options?: { useJitter?: boolean; jitterMaxPercent?: number },
    ): Promise<void>;

    /**
     * Gets a key's value from the cache, parsing JSON values automatically.
     *
     * @param key Cache key.
     * @returns A promise resolving to the typed value if found, otherwise null.
     */
    get<T = string>(key: string): Promise<T | null>;

    /**
     * Deletes a key from the cache.
     *
     * @param key Cache key.
     * @returns A promise resolving on execution success.
     */
    delete(key: string): Promise<void>;
}
