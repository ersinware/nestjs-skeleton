/**
 * @file rate-limit-health.port.ts
 * @description Contract for probing rate-limit storage connectivity.
 */

/**
 * Dependency injection token for the {@link IRateLimitHealthPort} contract.
 */
export const TOKEN_RATE_LIMIT_HEALTH_PORT = Symbol();

/**
 * Probes the rate-limit store without consuming counter budgets.
 */
export interface IRateLimitHealthPort {
    /**
     * Pings the rate-limit store within the configured command timeout.
     *
     * @throws {Error} When the store is unreachable or the probe times out.
     */
    ping(): Promise<void>;
}
