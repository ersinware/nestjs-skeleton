/**
 * @file database-health.port.ts
 * @description Outbound port for verifying database connectivity, one token per connection.
 */

/**
 * Dependency injection token representing the {@link IDatabaseHealthPort} contract for the primary
 * connection.
 */
export const TOKEN_DATABASE_HEALTH_PORT = Symbol();

/**
 * Dependency injection token representing the {@link IDatabaseHealthPort} contract for the replica
 * connection. Resolves to the primary's probe when no replica is configured.
 */
export const TOKEN_DATABASE_REPLICA_HEALTH_PORT = Symbol();

/**
 * Outbound port for verifying that a database connection accepts queries.
 */
export interface IDatabaseHealthPort {
    /**
     * Verifies connectivity with a trivial query.
     *
     * @throws {Error} The raw driver error when the database is unreachable.
     */
    ping(): Promise<void>;
}
