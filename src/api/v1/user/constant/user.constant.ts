/**
 * @file user.constant.ts
 * @description Defines domain-specific constants for the user module, including injection tokens and cache invalidation policies.
 */

/**
 * The dependency injection token representing the users repository contract interface.
 * Decouples the service layer from the concrete repository implementation.
 */
export const TOKEN_USERS_REPOSITORY = Symbol('TOKEN_USERS_REPOSITORY');

/**
 * The time-to-live in seconds for user cache entries.
 * Balances data freshness against database read loads.
 */
export const USER_CACHE_TTL_SECONDS = 300;
