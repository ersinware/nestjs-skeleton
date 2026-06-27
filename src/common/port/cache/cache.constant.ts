/**
 * @file cache.constant.ts
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

/**
 * Dependency injection token representing the cache operations service.
 */
export const TOKEN_CACHE_SERVICE = Symbol('TOKEN_CACHE_SERVICE');

/**
 * Dependency injection token representing the state operations service.
 */
export const TOKEN_CACHE_STATE_SERVICE = Symbol('TOKEN_CACHE_STATE_SERVICE');

/**
 * Dependency injection token representing the cache cleaner utility.
 */
export const TOKEN_CACHE_CLEANER_SERVICE = Symbol('TOKEN_CACHE_CLEANER_SERVICE');

/**
 * Dependency injection token representing the cache health check indicator.
 */
export const TOKEN_CACHE_HEALTH_INDICATOR = Symbol('TOKEN_CACHE_HEALTH_INDICATOR');
