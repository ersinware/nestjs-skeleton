/**
 * @file session-connection.token.ts
 * @description Dependency injection token for the session store Redis client.
 */

/**
 * Token for the configured session store Redis client. The session store is not a cache — it is
 * the authoritative store for sessions — so its connection lives with the session concern.
 */
export const TOKEN_SESSION_CONNECTION = Symbol('TOKEN_SESSION_CONNECTION');
