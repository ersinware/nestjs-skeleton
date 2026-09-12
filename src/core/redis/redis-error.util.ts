/**
 * @file redis-error.util.ts
 * @description Classifies Redis availability failures independently of consumer failure policies.
 */

/** Transport error codes for standalone Redis connections. */
const CONNECTION_CODES = new Set([
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
const CONNECTION_MESSAGES = new Set([
    'Connection is closed.',
    'Command timed out',
    "Stream isn't writeable and enableOfflineQueue options is false",
]);

/**
 * Recognizes transport failures and explicit temporary server unavailability.
 * Unknown, authentication, command and Lua errors remain unchanged.
 *
 * @param error The original driver failure
 * @returns Whether Redis is temporarily unavailable
 */
export function isRedisUnavailable(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const code = (error as NodeJS.ErrnoException).code;

    if (typeof code === 'string' && CONNECTION_CODES.has(code)) {
        return true;
    }

    if (error.name === 'MaxRetriesPerRequestError') {
        return true;
    }

    if (error.name === 'Error' && CONNECTION_MESSAGES.has(error.message)) {
        return true;
    }

    return error.name === 'ReplyError' && /^(LOADING|BUSY|TRYAGAIN|CLUSTERDOWN|MASTERDOWN)\b/.test(error.message);
}
