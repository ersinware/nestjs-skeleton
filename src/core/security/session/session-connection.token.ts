/**
 * @file session-connection.token.ts
 * @description Dependency injection token for the session store Redis client.
 */

/**
 * Dependency injection token representing the configured session store {@link Redis} client. The session store is not a cache — it is
 * the authoritative store for sessions — so its connection lives with the session concern.
 */
export const TOKEN_SESSION_CONNECTION = Symbol('TOKEN_SESSION_CONNECTION');
