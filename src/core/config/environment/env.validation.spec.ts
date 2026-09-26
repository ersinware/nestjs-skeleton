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
    // Keep fixture keys aligned with EnvironmentVariables at compile time.
    const validConfig = {
        PORT: 3000,
        NODE_ENV: Environment.DEVELOPMENT,
        TRUST_PROXY: 'false',

        DATABASE_URL: 'postgres://localhost:5432/db',
        DATABASE_REPLICA_URL: undefined,
        DATABASE_POOL_SIZE: 15,
        DATABASE_REPLICA_POOL_SIZE: undefined,
        DATABASE_CONNECT_TIMEOUT: 2,
        DATABASE_STATEMENT_TIMEOUT: 4,
        DATABASE_QUERY_TIMEOUT: 5,
        DATABASE_IDLE_TIMEOUT: 10,
        DATABASE_MAX_LIFETIME: 30,

        JOB_QUEUE_POOL_SIZE: 20,
        JOB_QUEUE_DLQ_MONITOR_ENABLED: true,
        JOB_QUEUE_DLQ_SAMPLE_INTERVAL: 60,

        REDIS_CACHE_HOST: 'localhost',
        REDIS_CACHE_PORT: 6379,
        REDIS_CACHE_PASSWORD: 'redis-password',
        REDIS_CACHE_TLS: false,
        REDIS_CACHE_MAX_RETRIES_PER_REQUEST: 0,
        REDIS_CACHE_COMMAND_TIMEOUT: 0.1,
        REDIS_SESSION_HOST: 'localhost',
        REDIS_SESSION_PORT: 6380,
        REDIS_SESSION_PASSWORD: 'redis-password',
        REDIS_SESSION_TLS: false,
        REDIS_SESSION_MAX_RETRIES_PER_REQUEST: 1,
        REDIS_SESSION_COMMAND_TIMEOUT: 0.5,

        SESSION_ABSOLUTE_TTL_ADMIN: '8h',
        SESSION_ABSOLUTE_TTL_USER: '7d',
        SESSION_ROTATION_GRACE_TTL: '30s',
        JWT_ACCESS_SECRET: 'access-secret-at-least-32-bytes!',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'refresh-secret-at-least-32-bytes',
        JWT_REFRESH_TTL: '7d',
        JWT_INVITE_SECRET: 'invite-secret-at-least-32-bytes!',
        ADMIN_INVITE_URL: 'http://localhost:3001/admin/activate',
        JWT_USER_ACTIVATION_SECRET: 'user-activation-secret-at-least-32-bytes',
        USER_ACTIVATION_URL: 'http://localhost:3001/user/activate',

        JWT_EMAIL_CONFIRM_SECRET: 'email-confirm-secret-at-least-32-bytes',
        ADMIN_EMAIL_CONFIRM_URL: 'http://localhost:3001/admin/email/confirm',
        USER_EMAIL_CONFIRM_URL: 'http://localhost:3001/user/email/confirm',

        HEALTH_HEAP_LIMIT_MB: 200,
        HEALTH_RSS_LIMIT_MB: 200,

        GMAIL_USER_EMAIL: 'user@gmail.com',
        GMAIL_CLIENT_ID: 'gmail-client-id',
        GMAIL_CLIENT_SECRET: 'gmail-client-secret',
        GMAIL_REFRESH_TOKEN: 'gmail-refresh-token',

        SENTRY_DSN: 'https://publickey@sentry.example/1',
        SENTRY_ENVIRONMENT: ExceptionTrackerEnvironment.TEST,

        OTEL_SDK_DISABLED: true,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://localhost:4318/v1/metrics',
        OTEL_SERVICE_NAME: 'nestjs-skeleton',
        OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=nestjs-skeleton,deployment.environment.name=test',
        OTEL_NODE_RESOURCE_DETECTORS: 'env,host,process,serviceinstance',
        OTEL_SEMCONV_STABILITY_OPT_IN: 'http',
    } satisfies Record<keyof EnvironmentVariables, unknown>;

    it.each(['env,host,process', 'serviceinstance,env,host,process', 'all', ''])(
        'should reject detector configuration that cannot guarantee the instance identity: %s',
        (detectors) => {
            expect(() => validateConfig({ ...validConfig, OTEL_NODE_RESOURCE_DETECTORS: detectors })).toThrow();
        },
    );

    it.each(['JWT_EMAIL_CONFIRM_SECRET', 'ADMIN_EMAIL_CONFIRM_URL', 'USER_EMAIL_CONFIRM_URL'])(
        'requires %s at startup',
        (key) => {
            const config: Record<string, unknown> = { ...validConfig };
            delete config[key];
            expect(() => validateConfig(config)).toThrow();
        },
    );

    it.each(['', ' '.repeat(32), 'short', 123])('rejects an invalid email confirmation secret: %s', (secret) => {
        expect(() => validateConfig({ ...validConfig, JWT_EMAIL_CONFIRM_SECRET: secret })).toThrow();
    });

    it.each(['ADMIN_EMAIL_CONFIRM_URL', 'USER_EMAIL_CONFIRM_URL'])(
        'accepts only absolute HTTP(S) confirmation URLs for %s',
        (key) => {
            for (const value of ['', '/confirm', 'ftp://localhost/confirm', 'https://']) {
                expect(() => validateConfig({ ...validConfig, [key]: value })).toThrow();
            }
            for (const value of ['http://localhost:3001/confirm', 'https://frontend.example/confirm']) {
                expect(() => validateConfig({ ...validConfig, [key]: value })).not.toThrow();
            }
        },
    );

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

    it('should explicitly convert numeric and boolean environment strings', () => {
        const result = validateConfig({
            ...validConfig,
            PORT: '4000',
            DATABASE_POOL_SIZE: '20',
            REDIS_CACHE_TLS: 'true',
            REDIS_SESSION_TLS: 'false',
            OTEL_SDK_DISABLED: 'false',
        });

        expect(result.PORT).toBe(4000);
        expect(result.DATABASE_POOL_SIZE).toBe(20);
        expect(result.REDIS_CACHE_TLS).toBe(true);
        expect(result.REDIS_SESSION_TLS).toBe(false);
        expect(result.OTEL_SDK_DISABLED).toBe(false);
    });

    it('should throw an error if a required field is missing', () => {
        const invalidConfig: Record<string, unknown> = { ...validConfig };
        delete invalidConfig['PORT'];

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it.each([
        ['true', true],
        ['false', false],
    ])('converts DLQ monitoring enablement %s', (value, expected) => {
        expect(
            validateConfig({ ...validConfig, JOB_QUEUE_DLQ_MONITOR_ENABLED: value }).JOB_QUEUE_DLQ_MONITOR_ENABLED,
        ).toBe(expected);
    });

    it.each([undefined, null, '', 'yes', '0', '1', 0, 1])('rejects invalid DLQ monitoring enablement %s', (value) => {
        expect(() => validateConfig({ ...validConfig, JOB_QUEUE_DLQ_MONITOR_ENABLED: value })).toThrow();
    });

    describe.each(['DATABASE_STATEMENT_TIMEOUT', 'DATABASE_QUERY_TIMEOUT'] as const)('%s', (key) => {
        it('should convert seconds from the environment', () => {
            const result = validateConfig({ ...validConfig, [key]: '4.5' });

            expect(result[key]).toBe(4.5);
        });

        it.each([undefined, '', 'invalid', 0, -1])('should reject an absent or invalid limit: %s', (value) => {
            expect(() => validateConfig({ ...validConfig, [key]: value })).toThrow(Error);
        });
    });

    it.each([
        ['PORT', 0],
        ['PORT', 65536],
        ['REDIS_CACHE_PORT', -1],
        ['REDIS_SESSION_PORT', 65536],
        ['DATABASE_POOL_SIZE', 0],
        ['DATABASE_POOL_SIZE', Number.MAX_SAFE_INTEGER + 1],
        ['REDIS_CACHE_MAX_RETRIES_PER_REQUEST', -1],
        ['REDIS_SESSION_MAX_RETRIES_PER_REQUEST', -1],
        ['DATABASE_CONNECT_TIMEOUT', 0],
        ['DATABASE_STATEMENT_TIMEOUT', 2147484],
        ['DATABASE_QUERY_TIMEOUT', 2147484],
        ['DATABASE_IDLE_TIMEOUT', -1],
        ['DATABASE_MAX_LIFETIME', 2147484],
        ['REDIS_CACHE_COMMAND_TIMEOUT', 0],
        ['REDIS_SESSION_COMMAND_TIMEOUT', 0],
        ['HEALTH_HEAP_LIMIT_MB', 0],
        ['HEALTH_RSS_LIMIT_MB', -1],
        ['SESSION_ABSOLUTE_TTL_ADMIN', '0h'],
        ['SESSION_ABSOLUTE_TTL_ADMIN', '8hours'],
        ['SESSION_ABSOLUTE_TTL_USER', '0d'],
        ['SESSION_ABSOLUTE_TTL_USER', '7days'],
        ['JWT_ACCESS_TTL', '0s'],
        ['JWT_REFRESH_TTL', '0d'],
        ['REDIS_CACHE_HOST', 'http://localhost'],
        ['REDIS_SESSION_HOST', '999.999.999.999'],
        ['TRUST_PROXY', '999.1.1.1'],
        ['TRUST_PROXY', '10.0.0.1/33'],
        ['SENTRY_DSN', 'https://sentry.example'],
    ] as const)('should reject invalid %s: %s', (key, value) => {
        expect(() => validateConfig({ ...validConfig, [key]: value })).toThrow(Error);
    });

    it.each(['1s', '10s', '30s', '60s', '1m'])('accepts bounded session rotation grace %s', (value) => {
        expect(validateConfig({ ...validConfig, SESSION_ROTATION_GRACE_TTL: value }).SESSION_ROTATION_GRACE_TTL).toBe(
            value,
        );
    });

    it.each([
        '0s',
        '00m',
        '61s',
        '2m',
        '1h',
        '1d',
        '-1s',
        '0.5s',
        '30',
        '30S',
        ' 30s',
        '30s ',
        '',
        '9007199254740992s',
        30,
        null,
    ])('rejects invalid session rotation grace %s', (value) => {
        expect(() => validateConfig({ ...validConfig, SESSION_ROTATION_GRACE_TTL: value })).toThrow(Error);
    });

    it('should preserve supported zero values and host forms', () => {
        const result = validateConfig({
            ...validConfig,
            TRUST_PROXY: '10.0.0.0/8,::1/128,loopback',
            DATABASE_IDLE_TIMEOUT: 0,
            DATABASE_MAX_LIFETIME: 0,
            REDIS_CACHE_HOST: 'redis-cache',
            REDIS_CACHE_MAX_RETRIES_PER_REQUEST: 0,
            REDIS_SESSION_HOST: '::1',
            REDIS_SESSION_MAX_RETRIES_PER_REQUEST: 0,
        });
        expect(result.DATABASE_IDLE_TIMEOUT).toBe(0);
        expect(result.DATABASE_MAX_LIFETIME).toBe(0);
        expect(result.REDIS_CACHE_MAX_RETRIES_PER_REQUEST).toBe(0);
        expect(result.REDIS_SESSION_MAX_RETRIES_PER_REQUEST).toBe(0);
        expect(result.REDIS_CACHE_HOST).toBe('redis-cache');
        expect(result.REDIS_SESSION_HOST).toBe('::1');
    });

    it('should throw an error if PORT is not a number', () => {
        const invalidConfig = {
            ...validConfig,
            PORT: 'not-a-number',
        };

        expect(() => validateConfig(invalidConfig)).toThrow(Error);
    });

    it.each(['', ' ', true, false, 'Infinity', '0x10'])('should reject numeric coercion of %s', (value) => {
        expect(() => validateConfig({ ...validConfig, PORT: value })).toThrow(Error);
    });

    it.each([
        'PORT',
        'DATABASE_POOL_SIZE',
        'REDIS_CACHE_PORT',
        'REDIS_SESSION_PORT',
        'REDIS_CACHE_MAX_RETRIES_PER_REQUEST',
        'REDIS_SESSION_MAX_RETRIES_PER_REQUEST',
    ])('should reject fractional %s', (key) => {
        expect(() => validateConfig({ ...validConfig, [key]: '1.5' })).toThrow(Error);
    });

    it.each([
        ['DATABASE_URL', 'https://localhost/db'],
        ['DATABASE_REPLICA_URL', 'not-a-url'],
        ['ADMIN_INVITE_URL', 'https://'],
        ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'ftp://localhost/traces'],
        ['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', 'not-a-url'],
        ['GMAIL_USER_EMAIL', 'not-an-email'],
        ['JWT_ACCESS_SECRET', '   '],
        ['JWT_REFRESH_SECRET', 123],
        ['OTEL_SDK_DISABLED', 'yes'],
        ['OTEL_RESOURCE_ATTRIBUTES', 'missing-assignment'],
    ] as const)('should reject malformed %s', (key, value) => {
        expect(() => validateConfig({ ...validConfig, [key]: value })).toThrow(Error);
    });

    it('should preserve optional replica and disabled authentication/telemetry values', () => {
        const result = validateConfig({
            ...validConfig,
            DATABASE_REPLICA_URL: '',
            REDIS_CACHE_PASSWORD: '',
            REDIS_SESSION_PASSWORD: '',
            SENTRY_DSN: '',
        });

        expect(result.DATABASE_REPLICA_URL).toBeUndefined();
        expect(result.REDIS_CACHE_PASSWORD).toBe('');
        expect(result.REDIS_SESSION_PASSWORD).toBe('');
        expect(result.SENTRY_DSN).toBe('');
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
