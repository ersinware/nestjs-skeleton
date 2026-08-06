/**
 * @file state-cleaner.port.ts
 * @description Interface defining the contract for cleaning the state (session store) Redis instance.
 */

/**
 * Dependency injection token representing the {@link IStateCleanerPort} contract.
 */
export const TOKEN_STATE_CLEANER_PORT = Symbol('TOKEN_STATE_CLEANER_PORT');

/**
 * Contract for wiping the state (session store) wholesale, so test cycles start from a clean slate.
 */
export interface IStateCleanerPort {
    /**
     * Flushes all keys from the state store.
     *
     * @throws {Error} The raw driver error when the flush fails.
     */
    cleanup(): Promise<void>;
}
