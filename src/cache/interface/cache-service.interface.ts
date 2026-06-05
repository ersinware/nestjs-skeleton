/**
 * @file cache-service.interface.ts
 * @description Interface defining the contract for application caching operations.
 */

export interface ICacheService {
    /**
     * Gets a key's value from the cache.
     *
     * @param key Cache key.
     * @returns A promise resolving to the value if found, otherwise null.
     */
    get(key: string): Promise<string | null>;

    /**
     * Sets a key's value in the cache with an optional expiration time.
     *
     * @param key Cache key.
     * @param value Cache value.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @returns A promise resolving on execution success.
     */
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;

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
