/**
 * @file forbidden-type.enum.ts
 * @description Enum defining the target types of forbidden failures for 403 Forbidden responses.
 */

/**
 * Enum defining the target types of forbidden failures for 403 Forbidden responses.
 */
export enum ForbiddenType {
    /**
     * Default permission failure message.
     */
    DEFAULT = 'You do not have permission to access or modify this resource.',
}
