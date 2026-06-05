/**
 * @file unauthorized-type.enum.ts
 * @description Enum defining the types of unauthorized authentication failures for 401 Unauthorized responses.
 */

/**
 * Enum defining the types of unauthorized authentication failures for 401 Unauthorized responses.
 */
export enum UnauthorizedType {
    /**
     * Targets invalid or expired tokens. Kept intentionally generic to avoid leaking token type information.
     */
    TOKEN = 'Invalid or expired token.',
    /**
     * Targets invalid email or password credentials.
     */
    CREDENTIALS = 'Invalid email or password.',
    /**
     * Targets requests missing authentication credentials.
     */
    MISSING_CREDENTIALS = 'Authentication credentials are required.',
}
