/**
 * @file path.constant.ts
 * @description Global HTTP path constants shared by the composition root and the platform kernel, so route fragments used in more than one place have exactly one source of truth.
 */

/**
 * The global URL prefix every HTTP route is mounted under. Consumed by the composition root
 * (`setGlobalPrefix`) and by any core code that must reconstruct a full request path.
 */
export const GLOBAL_PREFIX = 'api';

/**
 * The route segment of the health probe endpoint. Owned here rather than in the health module
 * because the global exception filter must recognize the full health path and core cannot import a
 * module; the health controller consumes this same constant so the two can never drift apart.
 */
export const ROUTE_HEALTH = 'health';

/**
 * The exact request path of the health endpoint (global prefix + version-neutral health route),
 * whose intentional 503 must bypass response normalization in the global exception filter.
 */
export const PATH_HEALTH = `/${GLOBAL_PREFIX}/${ROUTE_HEALTH}`;
