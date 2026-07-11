/**
 * @file cache.port.ts
 * @description Interface defining the contract for application caching operations.
 */

/**
 * Dependency injection token representing the cache operations port.
 */
export const TOKEN_CACHE_PORT = Symbol('TOKEN_CACHE_PORT');

export interface ICachePort {
    /**
     * Gets a key's value from the cache, automatically parsing JSON values if applicable.
     *
     * @param key Cache key.
     * @returns A promise resolving to the typed value if found, otherwise null.
     */
    get<T = string>(key: string): Promise<T | null>;

    /**
     * Sets a key's value in the cache with an optional expiration time,
     * automatically serializing objects and stripping sensitive properties.
     *
     * @param key Cache key.
     * @param value Cache value, either a string or an object to serialize.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @param options Optional configuration parameters.
     * @param options.useJitter Optional flag to add random variation (jitter) to the expiration time.
     * @param options.jitterMaxPercent Maximum percentage of expiration time to vary.
     * @returns A promise resolving on execution success.
     */
    set(
        key: string,
        value: unknown,
        ttlSeconds?: number,
        options?: { useJitter?: boolean; jitterMaxPercent?: number },
    ): Promise<void>;

    /**
     * Deletes a key from the cache.
     *
     * @param key Cache key.
     * @returns A promise resolving on execution success.
     */
    delete(key: string): Promise<void>;

    /**
     * Deletes all keys matching a specific pattern from the cache.
     *
     * @param pattern Glob-style key pattern.
     * @returns A promise resolving on execution success.
     */
    deletePattern(pattern: string): Promise<void>;

    /**
     * Checks if a key exists in the cache.
     *
     * @param key Cache key.
     * @returns A promise resolving to true if the key exists, otherwise false.
     */
    exists(key: string): Promise<boolean>;
}
