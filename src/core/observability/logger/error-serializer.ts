/**
 * @file error-serializer.ts
 * @description Selects diagnostic error fields for structured logs, preserving context at its owning cause.
 */

import { AppException } from 'src/shared/exception';

/**
 * Keeps exception context with its error throughout the cause chain without exposing arbitrary
 * Error properties. Non-Error values retain their existing log representation.
 *
 * @param error The error or underlying cause being logged
 * @returns The selected error fields or the original non-Error value
 */
export function serializeError(error: unknown): unknown {
    if (error instanceof Error) {
        return {
            type: error.name,
            message: error.message,
            stack: error.stack,
            ...(error instanceof AppException && error.context && { context: error.context }),
            ...(error.cause != null && { cause: serializeError(error.cause) }),
        };
    }

    return error;
}
