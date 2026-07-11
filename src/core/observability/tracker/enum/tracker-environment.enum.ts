/**
 * @file sentry-environment.enum.ts
 * @description Enumeration representing valid Sentry environments in which the application can track exceptions.
 */

/**
 * Valid Sentry environment designations for exception grouping.
 */
export enum TrackerEnvironment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}
