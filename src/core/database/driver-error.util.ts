/**
 * @file driver-error.util.ts
 * @description Predicates classifying raw PostgreSQL driver errors, so writer adapters can translate them into the exception taxonomy at the port boundary.
 */

/**
 * Reports whether the given error is (or wraps) a PostgreSQL unique-constraint violation. Walks the
 * `cause` chain because Drizzle wraps the driver error in its own query error before rethrowing.
 *
 * @param error The error caught around a database write
 * @returns True when a unique constraint was violated
 */
export function isUniqueViolation(error: unknown): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
        if (current.name === 'PostgresError' && (current as { code?: unknown }).code === '23505') {
            return true;
        }
    }

    return false;
}
