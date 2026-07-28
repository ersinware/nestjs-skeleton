/**
 * @file state-cleaner.port.ts
 * @description Interface defining the contract for cleaning the state (session store) Redis instance.
 */

/**
 * Dependency injection token representing the state cleaner port.
 */
export const TOKEN_STATE_CLEANER_PORT = Symbol('TOKEN_STATE_CLEANER_PORT');

export interface IStateCleanerPort {
    /**
     * Flushes all keys from the state store.
     *
     * @returns A promise resolving on execution success.
     */
    cleanup(): Promise<void>;
}
