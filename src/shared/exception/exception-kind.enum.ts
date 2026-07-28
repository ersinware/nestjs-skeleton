/**
 * @file exception-kind.enum.ts
 * @description Transport-neutral failure categories carried by every AppException. Protocol adapters translate each kind into their own status vocabulary (e.g. HTTP statuses in the global exception filter).
 */

/**
 * Transport-neutral category of a failure. String-valued so the category survives serialization and
 * logging, unlike an `instanceof` check that dies at any process or transport boundary.
 */
export enum ExceptionKind {
    /** The requested resource does not exist or is not visible to the caller. */
    RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',

    /** The request conflicts with the current state of the resource (e.g. duplicate data, lost race). */
    RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',

    /** The caller is not authenticated or presented invalid credentials. */
    UNAUTHENTICATED = 'UNAUTHENTICATED',

    /** The caller is authenticated but lacks permission for the operation. */
    ACCESS_DENIED = 'ACCESS_DENIED',

    /** The input is invalid or violates a business rule in the current state. */
    INVALID_INPUT = 'INVALID_INPUT',

    /** A required dependency is unreachable; the condition is transient and retryable. */
    DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE',

    /** An unexpected internal failure with no more specific category. */
    SYSTEM = 'SYSTEM',
}
