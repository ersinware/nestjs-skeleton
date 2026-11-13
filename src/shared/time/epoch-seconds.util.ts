/**
 * @file epoch-seconds.util.ts
 * @description Provides the current Unix epoch timestamp in whole seconds.
 */

/**
 * Returns the current Unix epoch time truncated to whole seconds.
 *
 * @returns Current epoch timestamp in seconds
 */
export function nowEpochSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
