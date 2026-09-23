/**
 * @file job-queue-client.token.ts
 * @description Defines the dependency injection token for the pg-boss client.
 */

/**
 * Identifies the shared {@link PgBoss} client.
 */
export const TOKEN_JOB_QUEUE_CLIENT = Symbol();
