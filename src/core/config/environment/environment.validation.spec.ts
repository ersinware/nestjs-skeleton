/**
 * @file env.validation.config.spec.ts
 * @description Unit tests for environment variable validation and type transformation.
 */

import 'reflect-metadata';
import { Environment } from 'src/core/config/environment/enum/environment.enum';
import { EnvironmentVariables, validateConfig } from 'src/core/config/environment/environment.validation';
import { TrackerEnvironment } from 'src/core/observability';
import { describe, expect, it } from 'vitest';

describe('env.validation.config', () => {
    const validConfig: Record<string, unknown> = {
        PORT: 3000,
        NODE_ENV: Environment.DEVELOPMENT,
        DATABASE_URL: 'postgres://localhost:5432/db',
        DATABASE_POOL_SIZE: 10,
        DATABASE_CONNECT_TIMEOUT: 5000,
        DATABASE_IDLE_TIMEOUT: 10000,
        DATABASE_MAX_LIFETIME: 30000,

        REDIS_CACHE_HOST: 'localhost',
        REDIS_CACHE_PORT: 6379,
        REDIS_CACHE_PASSWORD: 'redis-password',
        REDIS_CACHE_TLS: false,
        REDIS_STATE_HOST: 'localhost',
        REDIS_STATE_PORT: 6380,
        REDIS_STATE_PASSWORD: 'redis-password',
        REDIS_STATE_TLS: false,
        REDIS_MAX_RETRIES_PER_REQUEST: 3,
        REDIS_COMMAND_TIMEOUT: 2000,

        JWT_ACCESS_SECRET: 'access-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '7d',
        SESSION_ROTATION_GRACE_TTL: '30s',

        THROTTLE_TTL: 60,
        THROTTLE_LIMIT: 100,
        THROTTLE_CRITICAL_TTL: 60000,
        THROTTLE_CRITICAL_LIMIT: 5,

        HEALTH_HEAP_LIMIT_MB: 200,
        HEALTH_RSS_LIMIT_MB: 200,

        RELAY_ENABLED: true,
        OUTBOX_WORKER_CONCURRENCY: 2,
        EMAIL_WORKER_CONCURRENCY: 2,

        GMAIL_CLIENT_ID: 'gmail-client-id',
        GMAIL_CLIENT_SECRET: 'gmail-client-secret',
        GMAIL_REFRESH_TOKEN: 'gmail-refresh-token',
        GMAIL_USER_EMAIL: 'user@gmail.com',

        SENTRY_DSN: 'https://sentry-dsn.com',
        SENTRY_ENVIRONMENT: TrackerEnvironment.TEST,

        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://localhost:4318/v1/metrics',
        OTEL_SERVICE_NAME: 'nestjs-skeleton',
    };

    it('should return a validated EnvironmentVariables instance when config is valid', () => {
        const result = validateConfig(validConfig);

        expect(result).toBeInstanceOf(EnvironmentVariables);
        expect(result.PORT).toBe(3000);
        expect(result.NODE_ENV).toBe(Environment.DEVELOPMENT);
        expect(result.DATABASE_URL).toBe('postgres://localhost:5432/db');
        expect(result.JWT_ACCESS_TTL).toBe('15m');
        expect(result.JWT_REFRESH_TTL).toBe('7d');
        expect(result.SENTRY_ENVIRONMENT).toBe(TrackerEnvironment.TEST);
    });

    it('should perform implicit type conversions (e.g. string numbers to numbers, string booleans to booleans)', () => {
        const result = validateConfig({
            ...validConfig,
            PORT: '4000',
            DATABASE_POOL_SIZE: '15',
            THROTTLE_TTL: '120',
            THROTTLE_CRITICAL_TTL: '1000',
            THROTTLE_CRITICAL_LIMIT: '2',
            REDIS_CACHE_TLS: 'true',
            REDIS_STATE_TLS: 'false',
        });

        expect(result.PORT).toBe(4000);
        expect(result.DATABASE_POOL_SIZE).toBe(15);
        expect(result.THROTTLE_TTL).toBe(120);
        expect(result.THROTTLE_CRITICAL_TTL).toBe(1000);
        expect(result.THROTTLE_CRITICAL_LIMIT).toBe(2);
        expect(result.REDIS_CACHE_TLS).toBe(true);
        expect(result.REDIS_STATE_TLS).toBe(false);
    });

    it('should throw an error if a required field is missing', () => {
        const invalidConfig = { ...validConfig };
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
