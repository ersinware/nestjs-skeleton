/**
 * @file user.constant.ts
 * @description Dependency injection tokens and constants for the user module.
 */

/**
 * Dependency injection token representing the users repository contract interface.
 */
export const TOKEN_USERS_REPOSITORY = Symbol('TOKEN_USERS_REPOSITORY');

/**
 * Time-to-live in seconds for user cache entries.
 */
export const USER_CACHE_TTL_SECONDS = 300;
