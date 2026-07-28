/**
 * @file node-env.enum.ts
 * @description Enumeration of the valid `NODE_ENV` execution environments.
 */

/**
 * Valid execution environments (`NODE_ENV`) in which the application can run.
 */
export enum Environment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}
