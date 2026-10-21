/**
 * @file driver-error.util.ts
 * @description Predicates classifying raw PostgreSQL driver errors — plus the shared connection-failure translation — so database adapters can translate them into the exception taxonomy at the port boundary.
 */

import { DatabaseError } from 'pg';
import {
    DependencyUnavailableException,
    DependencyUnavailableMessage,
    ExceptionKind,
    isExceptionOfKind,
} from 'src/shared/exception';

/**
 * Every code that means "the database is unreachable" rather than "this query is wrong": Node socket
 * errno codes, selected PostgreSQL connection exceptions (excluding protocol violations),
 * operator-initiated shutdown, and connection-slot exhaustion.
 */
const CONNECTION_FAILURE_CODES: ReadonlySet<string> = new Set([
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
    '08007',
    '57P01',
    '57P02',
    '57P03',
    '53300',
]);

/**
 * Code-less pg/pg-pool connection failures. A rollback on a broken client can replace the original
 * failure with the non-queryable message. Query timeouts and deliberately closed clients stay distinct.
 */
const CONNECTION_FAILURE_MESSAGES: ReadonlySet<string> = new Set([
    'timeout exceeded when trying to connect',
    'timeout expired',
    'Connection terminated',
    'Connection terminated unexpectedly',
    'Connection terminated due to connection timeout',
    'Client has encountered a connection error and is not queryable',
]);

/**
 * Reports whether the given error is (or wraps) a PostgreSQL unique-constraint violation. Walks the
 * `cause` chain because Drizzle wraps the driver error in its own query error before rethrowing.
 *
 * @param error The error caught around a database write
 * @param constraint Optional owned constraint name to match
 * @returns True when a unique constraint was violated
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
        if (
            current instanceof DatabaseError &&
            current.code === '23505' &&
            (constraint === undefined || current.constraint === constraint)
        ) {
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
    if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
        return error;
    }

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
        const code = (current as { readonly code?: unknown }).code;

        if (typeof code === 'string' && CONNECTION_FAILURE_CODES.has(code)) {
            return true;
        }

        if (CONNECTION_FAILURE_MESSAGES.has(current.message)) {
            return true;
        }
    }

    return false;
}
