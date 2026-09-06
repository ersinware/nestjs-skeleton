/**
 * @file database-client.token.ts
 * @description Dependency injection tokens for the primary and replica database clients.
 */

/**
 * Dependency injection token for the Drizzle client on the primary connection: every write, every
 * read that feeds a write decision, and every cacheable query.
 */
export const TOKEN_DATABASE_CLIENT = Symbol('TOKEN_DATABASE_CLIENT');

/**
 * Dependency injection token for the Drizzle client on the replica connection: reads that accept
 * replication lag. Resolves to the primary client when no replica is configured.
 */
export const TOKEN_DATABASE_REPLICA_CLIENT = Symbol('TOKEN_DATABASE_REPLICA_CLIENT');
