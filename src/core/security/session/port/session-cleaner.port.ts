/**
 * @file session-cleaner.port.ts
 * @description Contract for wiping the session store.
 */

/**
 * Dependency injection token for the {@link ISessionCleanerPort} contract.
 */
export const TOKEN_SESSION_CLEANER_PORT = Symbol();

/**
 * Contract for wiping the session store wholesale, so E2E test cycles start from a clean slate.
 */
export interface ISessionCleanerPort {
    /**
     * Flushes all keys from the session store.
     *
     * @throws {Error} The raw driver error when the flush fails.
     */
    cleanup(): Promise<void>;
}
