/**
 * @file session-health.port.ts
 * @description Contract for probing session store connectivity.
 */

/**
 * Dependency injection token for the {@link ISessionHealthPort} contract.
 */
export const TOKEN_SESSION_HEALTH_PORT = Symbol();

/**
 * Contract for probing the session store connection, consumed by the health indicators.
 */
export interface ISessionHealthPort {
    /**
     * Pings the session store.
     *
     * @throws {Error} The raw driver error when the session store is unreachable.
     */
    ping(): Promise<void>;
}
