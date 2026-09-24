/**
 * @file runtime-flag.constant.ts
 * @description Constant map of environment flags injected by the tooling that runs the process
 * (test runner, CI provider), read to detect the execution context before the DI container exists.
 */

/**
 * Flags owned by the RUNNER of the process, not by its operator: deliberately absent from
 * `EnvironmentVariables`, since boot validation must not constrain values the application does not
 * own and that exist only in some execution contexts. Readers interpret them and fail safe.
 */
export const RUNTIME_FLAG = {
    /**
     * Set by Vitest for every process it spawns.
     */
    VITEST: 'VITEST',
    /**
     * Set to `'true'` by CI providers.
     */
    CI: 'CI',
} as const;
