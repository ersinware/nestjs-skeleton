/**
 * @file constant.ts
 * @description Database-related configuration constants and dependency injection tokens.
 */

/**
 * Dependency injection token representing the configured Drizzle ORM database client.
 */
export const TOKEN_DATABASE = Symbol('TOKEN_DATABASE');

export const CLS_TRANSACTION_KEY = Symbol('CLS_TRANSACTION_KEY');
