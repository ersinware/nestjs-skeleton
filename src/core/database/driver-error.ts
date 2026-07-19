/**
 * @file driver-error.ts
 * @description Predicates classifying raw PostgreSQL driver errors, so writer adapters can translate them into the exception taxonomy at the port boundary.
 */

import postgres from 'postgres';

/**
 * PostgreSQL error code raised when an INSERT or UPDATE breaks a unique constraint.
 */
const CODE_UNIQUE_VIOLATION = '23505';

/**
 * Reports whether the given error is (or wraps) a PostgreSQL unique-constraint violation. Walks the
 * `cause` chain because Drizzle wraps the driver error in its own query error before rethrowing.
 *
 * @param error The error caught around a database write
 * @returns True when a unique constraint was violated
 */
export function isUniqueViolation(error: unknown): boolean {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
        if (current instanceof postgres.PostgresError && current.code === CODE_UNIQUE_VIOLATION) {
            return true;
        }
    }

    return false;
}
