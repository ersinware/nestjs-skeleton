/**
 * @file outbox-client.token.ts
 * @description Private injection token for the pg-boss client.
 */

/**
 * Shares the initialized client between persistence and delivery.
 */
export const TOKEN_OUTBOX_CLIENT = Symbol('TOKEN_OUTBOX_CLIENT');
