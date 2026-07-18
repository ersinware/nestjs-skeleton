/**
 * @file too-many-requests-type.enum.ts
 * @description Enum defining the target types of validation failures for 429 Too Many Requests responses.
 */

/**
 * Enum defining the target types of validation failures for 429 Too Many Requests responses.
 */
export enum TooManyRequestsType {
    /**
     * Targets rate limit exceeded errors.
     */
    DEFAULT = 'Too many requests.',
}
