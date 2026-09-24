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
    /**
     * Captures from local development.
     */
    DEVELOPMENT = 'development',

    /**
     * Captures from production — the alerting environment.
     */
    PRODUCTION = 'production',

    /**
     * Captures from automated test runs.
     */
    TEST = 'test',
}
