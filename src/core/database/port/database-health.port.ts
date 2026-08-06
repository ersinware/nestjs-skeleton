/**
 * @file database-health.port.ts
 * @description Outbound port for verifying database connectivity.
 */

/**
 * Dependency injection token representing the {@link IDatabaseHealthPort} contract.
 */
export const TOKEN_DATABASE_HEALTH_PORT = Symbol('TOKEN_DATABASE_HEALTH_PORT');

/**
 * Outbound port for verifying that the database accepts queries.
 */
export interface IDatabaseHealthPort {
    /**
     * Verifies connectivity with a trivial query.
     *
     * @throws {Error} The raw driver error when the database is unreachable.
     */
    ping(): Promise<void>;
}
