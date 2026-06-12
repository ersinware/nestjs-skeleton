import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validateConfig, EnvironmentVariables } from './env.validation.config';

describe('env.validation.config', () => {
    const validConfig: Record<string, unknown> = {
        PORT: 3000,
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://localhost:5432/db',
        DATABASE_POOL_SIZE: 10,
        DATABASE_CONNECT_TIMEOUT: 5000,
        DATABASE_IDLE_TIMEOUT: 10000,
        DATABASE_MAX_LIFETIME: 30000,
        HEALTH_HEAP_LIMIT_MB: 200,
        HEALTH_RSS_LIMIT_MB: 200,
        THROTTLE_TTL: 60,
        THROTTLE_LIMIT: 100,
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_PASSWORD: 'redis-password',
        REDIS_MAX_RETRIES_PER_REQUEST: 3,
        REDIS_COMMAND_TIMEOUT: 2000,
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '7d',
        GMAIL_CLIENT_ID: 'gmail-client-id',
        GMAIL_CLIENT_SECRET: 'gmail-client-secret',
        GMAIL_REFRESH_TOKEN: 'gmail-refresh-token',
        GMAIL_USER_EMAIL: 'user@gmail.com',
    };

    it('should return a validated EnvironmentVariables instance when config is valid', () => {
        const result = validateConfig(validConfig);

        expect(result).toBeInstanceOf(EnvironmentVariables);
        expect(result.PORT).toBe(3000);
        expect(result.NODE_ENV).toBe('development');
        expect(result.DATABASE_URL).toBe('postgres://localhost:5432/db');
        expect(result.JWT_ACCESS_TTL).toBe('15m');
        expect(result.JWT_REFRESH_TTL).toBe('7d');
    });

    it('should perform implicit type conversions (e.g. string numbers to numbers)', () => {
        const result = validateConfig({
            ...validConfig,
            PORT: '4000',
            DATABASE_POOL_SIZE: '15',
            THROTTLE_TTL: '120',
        });

        expect(result.PORT).toBe(4000);
        expect(result.DATABASE_POOL_SIZE).toBe(15);
        expect(result.THROTTLE_TTL).toBe(120);
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

    it('should throw an error if NODE_ENV is not a valid enum value', () => {
        const invalidConfig = {
            ...validConfig,
            NODE_ENV: 'staging',
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
