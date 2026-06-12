/**
 * @file cache-service.interface.ts
 * @description Interface defining the contract for application caching operations.
 */

export interface ICacheService {
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
     * @returns A promise resolving on execution success.
     */
    set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;

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
