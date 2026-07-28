/**
 * @file state-health.port.ts
 * @description Interface defining the contract for verifying the health of the state (session store) Redis instance.
 */

/**
 * Dependency injection token representing the state health check indicator port.
 */
export const TOKEN_STATE_HEALTH_PORT = Symbol('TOKEN_STATE_HEALTH_PORT');

export interface IStateHealthPort {
    /**
     * Sends a ping query to verify connection to the state Redis instance.
     *
     * @returns A promise that resolves on query success, or rejects if query fails.
     */
    ping(): Promise<void>;
}
