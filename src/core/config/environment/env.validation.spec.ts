/**
 * @file env.validation.spec.ts
 * @description Unit tests for environment variable validation and type transformation.
 */

import 'reflect-metadata';
import { EnvironmentVariables, validateConfig } from 'src/core/config/environment/env.validation';
import { Environment } from 'src/core/config/environment/node-env.enum';
import { ExceptionTrackerEnvironment } from 'src/core/observability/exception-tracker';
import { describe, expect, it } from 'vitest';

describe('env.validation.config', () => {
    // `satisfies` binds the baseline to the declared contract: a variable added to
    // EnvironmentVariables without a value here — or removed there but left here — fails compilation.
    const validConfig = {
        PORT: 3000,
        NODE_ENV: Environment.DEVELOPMENT,
        TRUST_PROXY: 'false',
        DATABASE_URL: 'postgres://localhost:5432/db',
        DATABASE_POOL_SIZE: 10,
        DATABASE_CONNECT_TIMEOUT: 5000,
        DATABASE_IDLE_TIMEOUT: 10000,
        DATABASE_MAX_LIFETIME: 30000,

        REDIS_CACHE_HOST: 'localhost',
        REDIS_CACHE_PORT: 6379,
        REDIS_CACHE_PASSWORD: 'redis-password',
        REDIS_CACHE_TLS: false,
        REDIS_SESSION_HOST: 'localhost',
        REDIS_SESSION_PORT: 6380,
        REDIS_SESSION_PASSWORD: 'redis-password',
        REDIS_SESSION_TLS: false,
        REDIS_MAX_RETRIES_PER_REQUEST: 3,
        REDIS_COMMAND_TIMEOUT: 2000,

        JWT_ACCESS_SECRET: 'access-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '7d',
        JWT_INVITE_SECRET: 'invite-secret',
        JWT_INVITE_TTL: '3d',
        ADMIN_INVITE_URL: 'http://localhost:3001/admin/activate',
        SESSION_ROTATION_GRACE_TTL: '30s',

        HEALTH_HEAP_LIMIT_MB: 200,
        HEALTH_RSS_LIMIT_MB: 200,

        GMAIL_CLIENT_ID: 'gmail-client-id',
        GMAIL_CLIENT_SECRET: 'gmail-client-secret',
        GMAIL_REFRESH_TOKEN: 'gmail-refresh-token',
        GMAIL_USER_EMAIL: 'user@gmail.com',

        SENTRY_DSN: 'https://sentry-dsn.com',
        SENTRY_ENVIRONMENT: ExceptionTrackerEnvironment.TEST,

        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://localhost:4318/v1/metrics',
        OTEL_SERVICE_NAME: 'nestjs-skeleton',
        OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=nestjs-skeleton,deployment.environment.name=test',
        OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
        OTEL_TRACES_SAMPLER_ARG: 1,
    } satisfies Record<keyof EnvironmentVariables, unknown>;

    it('should return a validated EnvironmentVariables instance when config is valid', () => {
        const result = validateConfig(validConfig);

        expect(result).toBeInstanceOf(EnvironmentVariables);
        expect(result.PORT).toBe(3000);
        expect(result.NODE_ENV).toBe(Environment.DEVELOPMENT);
        expect(result.DATABASE_URL).toBe('postgres://localhost:5432/db');
        expect(result.JWT_ACCESS_TTL).toBe('15m');
        expect(result.JWT_REFRESH_TTL).toBe('7d');
        expect(result.SENTRY_ENVIRONMENT).toBe(ExceptionTrackerEnvironment.TEST);
    });

    it('should perform implicit type conversions (e.g. string numbers to numbers, string booleans to booleans)', () => {
        const result = validateConfig({
            ...validConfig,
            PORT: '4000',
            DATABASE_POOL_SIZE: '15',
            REDIS_CACHE_TLS: 'true',
            REDIS_SESSION_TLS: 'false',
        });

        expect(result.PORT).toBe(4000);
        expect(result.DATABASE_POOL_SIZE).toBe(15);
        expect(result.REDIS_CACHE_TLS).toBe(true);
        expect(result.REDIS_SESSION_TLS).toBe(false);
    });

    it('should throw an error if a required field is missing', () => {
        const invalidConfig: Record<string, unknown> = { ...validConfig };
        delete invalidConfig['PORT'];

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it('should throw an error if PORT is not a number', () => {
        const invalidConfig = {
            ...validConfig,
            PORT: 'not-a-number',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it('should throw an error if REDIS_CACHE_TLS is not a boolean', () => {
        const invalidConfig = {
            ...validConfig,
            REDIS_CACHE_TLS: 'not-a-boolean',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it('should throw an error if NODE_ENV is not a valid enum value', () => {
        const invalidConfig = {
            ...validConfig,
            NODE_ENV: 'staging',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it('should throw an error if SENTRY_ENVIRONMENT is not a valid enum value', () => {
        const invalidConfig = {
            ...validConfig,
            SENTRY_ENVIRONMENT: 'staging',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it('should throw an error if JWT_ACCESS_TTL format is invalid', () => {
        const invalidConfig = {
            ...validConfig,
            JWT_ACCESS_TTL: '15minutes',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it('should throw an error if JWT_REFRESH_TTL format is invalid', () => {
        const invalidConfig = {
            ...validConfig,
            JWT_REFRESH_TTL: '7days',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });
});
