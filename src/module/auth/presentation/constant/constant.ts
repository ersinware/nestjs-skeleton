/**
 * @file constant.ts
 * @description Defines presentation-layer constants for the authentication module, ensuring magic numbers or strings are not scattered throughout the codebase.
 */

/**
 * The maximum character length allowed for JWT tokens.
 * Enforced during validation to prevent denial-of-service via massive token payloads.
 */
export const TOKEN_MAX_LENGTH = 2048;
