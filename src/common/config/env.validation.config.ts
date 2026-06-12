/**
 * @file env.validation.config.ts
 * @description Configuration file that manages the validation, type conversion, and verification of environment variables used across the application.
 * It prevents the application from starting with invalid or missing environment variables.
 */

import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, Matches, validateSync } from 'class-validator';

/**
 * Enum representing valid execution environments (NODE_ENV) in which the application can run.
 */
enum Environment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}

/**
 * Environment variables DTO class used for validating environment variables.
 * `class-validator` decorators are used to enforce types and constraints on each variable.
 */
export class EnvironmentVariables {
    /**
     * The port number on which the application will listen.
     */
    @IsNumber()
    readonly PORT!: number;

    /**
     * The environment in which the application runs.
     */
    @IsEnum(Environment)
    readonly NODE_ENV!: Environment;

    /**
     * PostgreSQL database connection URL.
     */
    @IsString()
    readonly DATABASE_URL!: string;

    /**
     * Maximum number of connections in the database connection pool.
     */
    @IsNumber()
    readonly DATABASE_POOL_SIZE!: number;

    /**
     * Database connection timeout in milliseconds.
     */
    @IsNumber()
    readonly DATABASE_CONNECT_TIMEOUT!: number;

    /**
     * Idle timeout in milliseconds for database connections to be terminated.
     */
    @IsNumber()
    readonly DATABASE_IDLE_TIMEOUT!: number;

    /**
     * Maximum lifetime of a database connection in milliseconds.
     */
    @IsNumber()
    readonly DATABASE_MAX_LIFETIME!: number;

    /**
     * Hostname or IP address of the Redis Cache server.
     */
    @IsString()
    readonly REDIS_CACHE_HOST!: string;

    /**
     * Port number on which the Redis Cache server is listening.
     */
    @IsNumber()
    readonly REDIS_CACHE_PORT!: number;

    /**
     * Password for Redis Cache authentication.
     */
    @IsString()
    readonly REDIS_CACHE_PASSWORD!: string;

    /**
     * Hostname or IP address of the Redis State server.
     */
    @IsString()
    readonly REDIS_STATE_HOST!: string;

    /**
     * Port number on which the Redis State server is listening.
     */
    @IsNumber()
    readonly REDIS_STATE_PORT!: number;

    /**
     * Password for Redis State authentication.
     */
    @IsString()
    readonly REDIS_STATE_PASSWORD!: string;

    /**
     * Maximum number of Redis reconnection retries per request.
     */
    @IsNumber()
    readonly REDIS_MAX_RETRIES_PER_REQUEST!: number;

    /**
     * Redis command execution timeout in milliseconds.
     */
    @IsNumber()
    readonly REDIS_COMMAND_TIMEOUT!: number;

    /**
     * Secret key for signing JWT access tokens.
     */
    @IsString()
    readonly JWT_ACCESS_SECRET!: string;

    /**
     * Time-to-live for JWT access tokens (e.g., '15m').
     */
    @IsString()
    @Matches(/^\d+[smhd]$/, {
        message: 'JWT_ACCESS_TTL must match the format: duration followed by s, m, h, or d (e.g., "15m", "7d")',
    })
    readonly JWT_ACCESS_TTL!: string;

    /**
     * Secret key for signing JWT refresh tokens.
     */
    @IsString()
    readonly JWT_REFRESH_SECRET!: string;

    /**
     * Time-to-live for JWT refresh tokens (e.g., '7d').
     */
    @IsString()
    @Matches(/^\d+[smhd]$/, {
        message: 'JWT_REFRESH_TTL must match the format: duration followed by s, m, h, or d (e.g., "7d", "30d")',
    })
    readonly JWT_REFRESH_TTL!: string;

    /**
     * Time-to-live (TTL) window in seconds for the rate limiter.
     */
    @IsNumber()
    readonly THROTTLE_TTL!: number;

    /**
     * Maximum number of requests allowed within the defined THROTTLE_TTL window.
     */
    @IsNumber()
    readonly THROTTLE_LIMIT!: number;

    /**
     * Heap memory limit (in MB) for system health checks.
     */
    @IsNumber()
    readonly HEALTH_HEAP_LIMIT_MB!: number;

    /**
     * Resident Set Size (RSS) limit (in MB) for system health checks.
     */
    @IsNumber()
    readonly HEALTH_RSS_LIMIT_MB!: number;

    /**
     * Google OAuth2 client ID for Gmail API.
     */
    @IsString()
    readonly GMAIL_CLIENT_ID!: string;

    /**
     * Google OAuth2 client secret for Gmail API.
     */
    @IsString()
    readonly GMAIL_CLIENT_SECRET!: string;

    /**
     * Google OAuth2 refresh token for Gmail API.
     */
    @IsString()
    readonly GMAIL_REFRESH_TOKEN!: string;

    /**
     * Sender email address for Gmail API.
     */
    @IsString()
    readonly GMAIL_USER_EMAIL!: string;
}

/**
 * Transforms incoming raw environment variables into the `EnvironmentVariables` class and validates them.
 * Throws an error to prevent application startup if any validation constraints fail.
 *
 * @param config Raw object containing environment variables (typically process.env).
 * @returns Validated and typed environment variables instance.
 * @throws {Error} containing validation failure details if any environment variable is missing or invalid.
 */
export function validateConfig(config: Record<string, unknown>) {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, {
            enableImplicitConversion: true,
        }),
        errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }

    return validatedConfig;
}
