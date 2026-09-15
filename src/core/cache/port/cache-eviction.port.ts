/**
 * @file cache-eviction.port.ts
 * @description Cache key deletion contract with explicit failure propagation.
 */

/**
 * Dependency injection token for {@link ICacheEvictionPort}.
 */
export const TOKEN_CACHE_EVICTION_PORT = Symbol('TOKEN_CACHE_EVICTION_PORT');

/**
 * Deletes cached entries without suppressing deletion failures.
 */
export interface ICacheEvictionPort {
    /**
     * Deletes a key, succeeding also when the key is already absent.
     *
     * @param key Cache key.
     * @throws {SystemException} When the key is empty.
     * @throws {Error} Redis failures propagate unchanged to the caller.
     */
    delete(key: string): Promise<void>;
}
