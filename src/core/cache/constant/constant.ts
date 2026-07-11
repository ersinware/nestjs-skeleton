/**
 * @file constant.ts
 * @description Configuration constants and dependency injection tokens for the cache connection client and services.
 */

/**
 * Dependency injection token representing the configured cache client instance.
 */
export const TOKEN_CACHE_CLIENT = Symbol('TOKEN_CACHE_CLIENT');

/**
 * Dependency injection token representing the configured state client instance.
 */
export const TOKEN_CACHE_STATE_CLIENT = Symbol('TOKEN_CACHE_STATE_CLIENT');
