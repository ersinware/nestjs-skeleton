/**
 * @file state-health.port.ts
 * @description Interface defining the contract for verifying the health of the state (session store) Redis instance.
 */

/**
 * Dependency injection token representing the {@link IStateHealthPort} contract.
 */
export const TOKEN_STATE_HEALTH_PORT = Symbol('TOKEN_STATE_HEALTH_PORT');

/**
 * Contract for probing the state (session store) Redis connection, consumed by the health indicators.
 */
export interface IStateHealthPort {
    /**
     * Sends a ping query to verify connection to the state Redis instance.
     *
     * @throws {Error} The raw driver error when the state store is unreachable.
     */
    ping(): Promise<void>;
}
