/**
 * @file exception-tracker-environment.enum.ts
 * @description Enumeration representing valid environments the exception tracker groups captured
 * exceptions under.
 */

/**
 * Valid environment designations for exception grouping. Deliberately its own vocabulary rather
 * than a reuse of `Environment` (NODE_ENV): the tracker's environment tag is a contract with the
 * tracking service and may diverge (e.g. gain `staging`) without the runtime mode doing so.
 */
export enum ExceptionTrackerEnvironment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}
