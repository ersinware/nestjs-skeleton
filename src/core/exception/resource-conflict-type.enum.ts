/**
 * @file conflict-type.enum.ts
 * @description Enum defining the target types of conflict failures for 409 Conflict responses.
 */

/**
 * Enum defining the target types of conflict failures for 409 Conflict responses.
 */
export enum ResourceConflictType {
    /**
     * Targets generic resource conflict errors.
     */
    DEFAULT = 'Resource already exists.',
    /**
     * Targets email conflict errors.
     */
    EMAIL_IN_USE = 'Email address is already in use.',
    /**
     * Targets foreign key constraint violations.
     */
    FOREIGN_KEY_VIOLATION = 'The related resource does not exist or is still in use.',
    /**
     * Targets a refresh that lost a concurrent rotation race: a newer session already exists, so the
     * client should simply retry with its latest token pair. Benign — not refresh-token reuse.
     */
    CONCURRENT_REFRESH = 'A newer session already exists; retry with the latest token.',
}
