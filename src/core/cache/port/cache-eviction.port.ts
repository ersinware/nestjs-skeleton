/**
 * @file cache-eviction.port.ts
 * @description Cache eviction contract that exposes failures for delivery retries.
 */

/** Dependency injection token for {@link ICacheEvictionPort}. */
export const TOKEN_CACHE_EVICTION_PORT = Symbol('TOKEN_CACHE_EVICTION_PORT');

/** Cache eviction for consumers that must observe failed invalidation. */
export interface ICacheEvictionPort {
    /**
     * Deletes a key, succeeding also when the key is already absent.
     *
     * @param key Cache key.
     * @throws {SystemException} When the key is empty.
     * @throws {Error} Redis failures propagate unchanged so delivery can be retried.
     */
    delete(key: string): Promise<void>;
}
