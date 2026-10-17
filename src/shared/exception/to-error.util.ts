/**
 * @file to-error.util.ts
 * @description Normalizes thrown values for reporting boundaries that require an Error.
 */

/**
 * Preserves existing errors and wraps other values without letting failed string conversion
 * replace the original failure. A wrapper's stack identifies the reporting boundary.
 *
 * @param value The caught value to report
 * @returns The original Error or a wrapper retaining the original value as cause
 */
export function toError(value: unknown): Error {
    if (value instanceof Error) {
        return value;
    }

    try {
        return new Error(String(value), { cause: value });
    } catch {
        return new Error('Non-Error value thrown', { cause: value });
    }
}
