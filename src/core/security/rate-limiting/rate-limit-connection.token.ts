/**
 * @file rate-limit-connection.token.ts
 * @description Private connection identity for the dedicated counter store.
 */

/**
 * Injection token representing the rate-limit {@link RedisClientType} connection.
 */
export const TOKEN_RATE_LIMIT_CONNECTION = Symbol('TOKEN_RATE_LIMIT_CONNECTION');
