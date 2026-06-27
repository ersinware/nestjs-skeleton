/**
 * @file database.constant.ts
 * @description Database-related configuration constants and dependency injection tokens.
 */

/**
 * Dependency injection token representing the configured Drizzle ORM database client.
 */
export const TOKEN_DATABASE = Symbol('TOKEN_DATABASE');

/**
 * Dependency injection token representing the database cleaner utility.
 */
export const TOKEN_DATABASE_CLEANER = Symbol('TOKEN_DATABASE_CLEANER');

/**
 * Dependency injection token representing the database health check validator.
 */
export const TOKEN_DATABASE_HEALTH_INDICATOR = Symbol('TOKEN_DATABASE_HEALTH_INDICATOR');

/**
 * The maximum integer limit allowed in Postgres 4-byte integer columns (standard INTEGER).
 * Often used for validation boundaries.
 */
export const MAX_INT_DATABASE = 2147483647;
