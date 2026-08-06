/**
 * @file exception-tracker-environment.enum.ts
 * @description Environments the exception tracker groups captured exceptions under.
 */

/**
 * Environment tag for exception grouping. Deliberately separate from `Environment` (NODE_ENV):
 * this is a contract with the tracking service and may diverge (e.g. gain `staging`) without the
 * runtime mode doing so.
 */
export enum ExceptionTrackerEnvironment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}
