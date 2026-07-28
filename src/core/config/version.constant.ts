/**
 * @file version.constant.ts
 * @description Global API version constants to enforce type-safety across controllers.
 */

/**
 * Route segment of API version 1, consumed by controllers' `@Version` and the Swagger documents.
 */
export const VERSION_1 = '1';

/**
 * Union of the API versions currently active; widens as new versions ship.
 */
export type APIVersion = typeof VERSION_1;

/**
 * Every active API version, each of which gets its own Swagger document.
 */
export const ACTIVE_VERSIONS: readonly APIVersion[] = [VERSION_1];
