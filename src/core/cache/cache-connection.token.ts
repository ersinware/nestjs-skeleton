/**
 * @file cache-connection.token.ts
 * @description Dependency injection token for the raw Redis connection backing the cache concern.
 */

/**
 * Dependency injection token representing the configured raw Redis connection of the cache concern.
 * Internal wiring: only the cache adapters inject it — consumers reach Redis through the ports.
 * Its description names the connection in the connection-level LOST/RESTORED logs, so it must stay
 * distinguishable from the other Redis connections (e.g. the session store).
 */
export const TOKEN_CACHE_CONNECTION = Symbol('TOKEN_CACHE_CONNECTION');
