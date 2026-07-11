/**
 * @file database-health.port.ts
 * @description Interface defining the contract for verifying database connectivity status.
 */

/**
 * Dependency injection token representing the database health check validator.
 */
export const TOKEN_DATABASE_HEALTH_PORT = Symbol('TOKEN_DATABASE_HEALTH_PORT');

/**
 * Outbound port for performing database health checks.
 */
export interface IDatabaseHealthPort {
    /**
     * Sends a ping query to verify connection to the database.
     *
     * @returns A promise that resolves on query success, or rejects if query fails.
     */
    ping(): Promise<void>;
}
