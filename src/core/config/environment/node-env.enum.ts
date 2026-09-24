/**
 * @file node-env.enum.ts
 * @description Enumeration of the valid `NODE_ENV` execution environments.
 */

/**
 * Valid execution environments (`NODE_ENV`) in which the application can run.
 */
export enum Environment {
    /**
     * Local development; verbose, human-readable logging.
     */
    DEVELOPMENT = 'development',

    /**
     * Production deployment; structured logging, no dev-only tooling.
     */
    PRODUCTION = 'production',

    /**
     * Automated test runs; operational logs are silenced.
     */
    TEST = 'test',
}
