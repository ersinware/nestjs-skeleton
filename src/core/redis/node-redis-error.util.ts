/**
 * @file node-redis-error.util.ts
 * @description Classifies node-redis availability and capacity failures independently of consumer failure policies.
 */

import {
    AbortError,
    ClientClosedError,
    ClientOfflineError,
    ConnectionTimeoutError,
    DisconnectsClientError,
    ErrorReply,
    SocketClosedUnexpectedlyError,
    SocketTimeoutError,
    TimeoutError,
} from 'redis';

/**
 * Transport error codes for standalone Redis connections.
 */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'EPIPE',
]);

/**
 * Recognizes transport failures, cancellation, capacity exhaustion and temporary server unavailability through the cause chain.
 * Unknown, authentication, command and Lua errors remain unchanged.
 *
 * @param error The original driver failure
 * @returns Whether the Redis operation is unavailable
 */
export function isNodeRedisUnavailable(error: unknown): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
        const code = (current as NodeJS.ErrnoException).code;

        if (typeof code === 'string' && CONNECTION_CODES.has(code)) {
            return true;
        }

        if (
            current instanceof ClientClosedError ||
            current instanceof ClientOfflineError ||
            current instanceof ConnectionTimeoutError ||
            current instanceof DisconnectsClientError ||
            current instanceof SocketClosedUnexpectedlyError ||
            current instanceof SocketTimeoutError ||
            current instanceof TimeoutError ||
            current instanceof AbortError
        ) {
            return true;
        }

        if (
            current instanceof ErrorReply &&
            (/^(OOM|LOADING|BUSY|TRYAGAIN|CLUSTERDOWN|MASTERDOWN)\b/.test(current.message) ||
                current.message === 'ERR max number of clients reached')
        ) {
            return true;
        }
    }

    return false;
}
