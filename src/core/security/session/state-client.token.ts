/**
 * @file state-client.token.ts
 * @description Dependency injection token for the state (session store) Redis client.
 */

/**
 * Dependency injection token representing the configured state Redis client instance.
 * State is not a cache: it is the authoritative store for sessions, so it lives with the
 * session concern that owns it.
 */
export const TOKEN_STATE_CLIENT = Symbol('TOKEN_STATE_CLIENT');
