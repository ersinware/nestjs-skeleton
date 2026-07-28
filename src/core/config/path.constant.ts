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
 * The route segment the health probes are mounted under. Owned here rather than in the health module
 * because the global exception filter must recognize the full health paths and core cannot import a
 * module; the health controller consumes these same constants so the two can never drift apart.
 */
export const ROUTE_HEALTH = 'health';

/**
 * The route segment of the liveness probe — "is this process still able to answer at all", the
 * question a container orchestrator answers with a restart. It checks no dependency by design.
 */
export const ROUTE_HEALTH_LIVE = 'live';

/**
 * The route segment of the readiness probe — "can this instance serve traffic right now", the
 * question an orchestrator answers by removing the instance from the load balancer.
 */
export const ROUTE_HEALTH_READY = 'ready';

/**
 * The exact request path of the detailed health endpoint (global prefix + version-neutral health
 * route), whose intentional 503 must bypass response normalization in the global exception filter.
 */
export const PATH_HEALTH = `/${GLOBAL_PREFIX}/${ROUTE_HEALTH}`;

/**
 * The exact request path of the readiness probe, whose intentional 503 must reach the orchestrator
 * as a bare status code — the filter suppresses the body entirely rather than normalizing it.
 */
export const PATH_HEALTH_READY = `${PATH_HEALTH}/${ROUTE_HEALTH_READY}`;
