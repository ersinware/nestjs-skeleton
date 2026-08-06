/**
 * @file index.ts
 * @description Public entry point of the config concern. Nothing outside may import past this barrel.
 */

export { ENV } from 'src/core/config/environment/env.constant';
export { validateConfig } from 'src/core/config/environment/env.validation';
export type { EnvironmentVariables } from 'src/core/config/environment/env.validation';
export { Environment } from 'src/core/config/environment/node-env.enum';
export { resolveTrustProxy } from 'src/core/config/environment/trust-proxy.util';
export {
    GLOBAL_PREFIX,
    PATH_HEALTH,
    PATH_HEALTH_READY,
    ROUTE_DOCS,
    ROUTE_HEALTH,
    ROUTE_HEALTH_LIVE,
    ROUTE_HEALTH_READY,
} from 'src/core/config/path.constant';
export { ACTIVE_VERSIONS, VERSION_1, VERSION_PREFIX } from 'src/core/config/version.constant';
export type { APIVersion } from 'src/core/config/version.constant';
