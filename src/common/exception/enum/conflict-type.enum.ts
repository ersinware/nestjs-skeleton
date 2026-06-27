/**
 * @file conflict-type.enum.ts
 * @description Enum defining the target types of conflict failures for 409 Conflict responses.
 */

/**
 * Enum defining the target types of conflict failures for 409 Conflict responses.
 */
export enum ConflictType {
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
}
