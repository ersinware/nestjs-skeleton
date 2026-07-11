/**
 * @file version.constant.ts
 * @description Global API version constants to enforce type-safety across controllers.
 */

/**
 * API Version 1 constant.
 */
export const VERSION_1 = '1' as const;

/**
 * Type representing active API version numbers for Swagger documentation.
 */
export type APIVersion = typeof VERSION_1;

/**
 * List of API versions currently active and documented.
 */
export const ACTIVE_VERSIONS: APIVersion[] = [VERSION_1];
