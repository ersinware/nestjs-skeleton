/**
 * @file redis-error.util.ts
 * @description Classifies Redis availability failures independently of consumer failure policies.
 */

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
 * Known textual transport failures produced by ioredis in this implementation.
 */
const CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
    'Connection is closed.',
    'Command timed out',
    "Stream isn't writeable and enableOfflineQueue options is false",
]);

/**
 * Recognizes transport failures and explicit temporary server unavailability through the cause chain.
 * Unknown, authentication, command and Lua errors remain unchanged.
 *
 * @param error The original driver failure
 * @returns Whether Redis is temporarily unavailable
 */
export function isRedisUnavailable(error: unknown): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
        const code = (current as NodeJS.ErrnoException).code;

        if (typeof code === 'string' && CONNECTION_CODES.has(code)) {
            return true;
        }

        if (current.name === 'MaxRetriesPerRequestError') {
            return true;
        }

        if (current.name === 'Error' && CONNECTION_MESSAGES.has(current.message)) {
            return true;
        }

        if (
            current.name === 'ReplyError' &&
            (/^(LOADING|BUSY|TRYAGAIN|CLUSTERDOWN|MASTERDOWN)\b/.test(current.message) ||
                current.message === 'ERR max number of clients reached')
        ) {
            return true;
        }
    }

    return false;
}
