/**
 * @file auth.constant.ts
 * @description Defines domain-specific constants for the authentication module, ensuring magic numbers or strings are not scattered throughout the codebase.
 */

/**
 * Injection token for the User identity provider contract.
 */
export const TOKEN_USER_IDENTITY_PROVIDER = Symbol('TOKEN_USER_IDENTITY_PROVIDER');

/**
 * Injection token for the Admin identity provider contract.
 */
export const TOKEN_ADMIN_IDENTITY_PROVIDER = Symbol('TOKEN_ADMIN_IDENTITY_PROVIDER');

/**
 * The maximum character length allowed for JWT tokens.
 * Enforced during validation to prevent denial-of-service via massive token payloads.
 */
export const TOKEN_MAX_LENGTH = 2048;
