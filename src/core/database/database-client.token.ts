/**
 * @file database-client.token.ts
 * @description Dependency injection tokens for the primary and replica database clients.
 */

/**
 * Dependency injection token representing the primary {@link NodePgDatabase} proxy: joins the ambient transaction
 * for writes, write-decision reads and cacheable queries; otherwise uses the primary client.
 */
export const TOKEN_DATABASE_CLIENT = Symbol('TOKEN_DATABASE_CLIENT');

/**
 * Dependency injection token representing the replica {@link NodePgDatabase} client: reads that accept
 * replication lag. Uses the primary proxy when no replica is configured.
 */
export const TOKEN_DATABASE_REPLICA_CLIENT = Symbol('TOKEN_DATABASE_REPLICA_CLIENT');
