/**
 * @file database-health-indicator.interface.ts
 * @description Interface defining the contract for verifying database connectivity status.
 */

export interface IDatabaseHealthIndicator {
    /**
     * Sends a ping query to verify connection to the database.
     *
     * @returns A promise that resolves on query success, or rejects if query fails.
     */
    ping(): Promise<void>;
}
