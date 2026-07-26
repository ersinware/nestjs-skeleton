/**
 * @file driver-error.ts
 * @description Predicates classifying raw PostgreSQL driver errors, so writer adapters can translate them into the exception taxonomy at the port boundary.
 */

/**
 * PostgreSQL error code raised when an INSERT or UPDATE breaks a unique constraint.
 */
const CODE_UNIQUE_VIOLATION = '23505';

/**
 * Error name postgres.js stamps onto every error it raises from a server response.
 */
const NAME_POSTGRES_ERROR = 'PostgresError';

/**
 * Reports whether the given error is (or wraps) a PostgreSQL unique-constraint violation. Walks the
 * `cause` chain because Drizzle wraps the driver error in its own query error before rethrowing.
 *
 * Classified structurally — by name and SQLSTATE — rather than with `instanceof postgres.PostgresError`.
 * A prototype check compares class identity, which silently returns false the moment a second copy of
 * the `postgres` package is resolved anywhere in the tree; the failure mode is a unique violation
 * escaping as a generic 500 + Sentry instead of the intended 409, with nothing pointing at the cause.
 * The SQLSTATE travels in the wire protocol, so it survives every packaging accident.
 *
 * @param error The error caught around a database write
 * @returns True when a unique constraint was violated
 */
export function isUniqueViolation(error: unknown): boolean {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
        if (current.name === NAME_POSTGRES_ERROR && (current as { code?: unknown }).code === CODE_UNIQUE_VIOLATION) {
            return true;
        }
    }

    return false;
}
