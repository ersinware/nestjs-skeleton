/**
 * @file env.constant.ts
 * @description Type-safe constant map of environment variable names derived from the EnvironmentVariables validation class.
 * Ensures compile-time safety by enforcing exact key parity with the validation schema.
 */

import type { EnvironmentVariables } from 'src/common/config/env.validation.config';

/**
 * Compile-time-safe mapping of every declared environment variable name to its string key.
 * Adding or removing a property in `EnvironmentVariables` without updating this object will cause a TypeScript compilation error.
 */
export const ENV = {
    PORT: 'PORT',
    NODE_ENV: 'NODE_ENV',
    DATABASE_URL: 'DATABASE_URL',
    DATABASE_POOL_SIZE: 'DATABASE_POOL_SIZE',
    DATABASE_CONNECT_TIMEOUT: 'DATABASE_CONNECT_TIMEOUT',
    DATABASE_IDLE_TIMEOUT: 'DATABASE_IDLE_TIMEOUT',
    DATABASE_MAX_LIFETIME: 'DATABASE_MAX_LIFETIME',
    HEALTH_HEAP_LIMIT_MB: 'HEALTH_HEAP_LIMIT_MB',
    HEALTH_RSS_LIMIT_MB: 'HEALTH_RSS_LIMIT_MB',
    THROTTLE_TTL: 'THROTTLE_TTL',
    THROTTLE_LIMIT: 'THROTTLE_LIMIT',
    REDIS_HOST: 'REDIS_HOST',
    REDIS_PORT: 'REDIS_PORT',
    REDIS_PASSWORD: 'REDIS_PASSWORD',
    REDIS_MAX_RETRIES_PER_REQUEST: 'REDIS_MAX_RETRIES_PER_REQUEST',
    REDIS_COMMAND_TIMEOUT: 'REDIS_COMMAND_TIMEOUT',
    JWT_ACCESS_SECRET: 'JWT_ACCESS_SECRET',
    JWT_ACCESS_TTL: 'JWT_ACCESS_TTL',
    JWT_REFRESH_SECRET: 'JWT_REFRESH_SECRET',
    JWT_REFRESH_TTL: 'JWT_REFRESH_TTL',
    GMAIL_CLIENT_ID: 'GMAIL_CLIENT_ID',
    GMAIL_CLIENT_SECRET: 'GMAIL_CLIENT_SECRET',
    GMAIL_REFRESH_TOKEN: 'GMAIL_REFRESH_TOKEN',
    GMAIL_USER_EMAIL: 'GMAIL_USER_EMAIL',
} as const satisfies Record<keyof EnvironmentVariables, string>;
