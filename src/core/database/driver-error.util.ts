/**
 * @file driver-error.util.ts
 * @description Predicates classifying raw PostgreSQL driver errors — plus the shared connection-failure translation — so database adapters can translate them into the exception taxonomy at the port boundary.
 */

import { DatabaseError } from 'pg';
import { DependencyUnavailableException, DependencyUnavailableMessage } from 'src/shared/exception';

/**
 * Every code that means "the database is unreachable" rather than "this query is wrong": Node socket
 * errno codes, and the PostgreSQL SQLSTATEs for connection exceptions (class 08), operator-initiated
 * shutdown (57Pxx), and connection-slot exhaustion (53300).
 */
const CONNECTION_FAILURE_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'EPIPE',
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '57P01',
    '57P02',
    '57P03',
    '53300',
]);

/**
 * The driver's own connection-lifecycle failures carry no code, only a message: the pool's
 * checkout timeout, and a socket the server closed mid-query.
 */
const CONNECTION_FAILURE_MESSAGES = ['timeout exceeded when trying to connect', 'Connection terminated'];

/**
 * Reports whether the given error is (or wraps) a PostgreSQL unique-constraint violation. Walks the
 * `cause` chain because Drizzle wraps the driver error in its own query error before rethrowing.
 *
 * @param error The error caught around a database write
 * @returns True when a unique constraint was violated
 */
export function isUniqueViolation(error: unknown): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
        if (current instanceof DatabaseError && current.code === '23505') {
            return true;
        }
    }

    return false;
}

/**
 * Translates a database error for rethrow at the port boundary: a connection failure becomes
 * {@link DependencyUnavailableException} carrying the driver error as `cause` (the taxonomy's 503,
 * silent per request — the connection-level probe logs the episode); anything else is returned
 * unchanged so it surfaces as 500 + Sentry. The function only translates — the `throw` stays at the
 * adapter's call site: `throw translateConnectionFailure(error)`.
 *
 * @param error The error caught around a database operation
 * @returns The taxonomy exception when the database is unreachable, the original error otherwise
 */
export function translateConnectionFailure(error: unknown): unknown {
    if (isConnectionFailure(error)) {
        return new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
    }

    return error;
}

/**
 * Reports whether the given error is (or wraps) a database connection failure — an outage of the
 * dependency, never a fault of the statement that happened to hit it. Walks the `cause` chain
 * because Drizzle wraps the driver error before rethrowing.
 *
 * @param error The error caught around a database operation
 * @returns True when the database is unreachable
 */
function isConnectionFailure(error: unknown): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
        const code = (current as { code?: unknown }).code;

        if (typeof code === 'string' && CONNECTION_FAILURE_CODES.has(code)) {
            return true;
        }

        if (CONNECTION_FAILURE_MESSAGES.some((message) => current.message.startsWith(message))) {
            return true;
        }
    }

    return false;
}
