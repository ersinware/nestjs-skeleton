/**
 * @file env.validation.config.ts
 * @description Configuration file that manages the validation, type conversion, and verification of environment variables used across the application.
 * It prevents the application from starting with invalid or missing environment variables.
 */

import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsString, Matches, validateSync } from 'class-validator';
import { Environment } from 'src/core/config/environment/enum';
import { TrackerEnvironment } from 'src/core/observability/tracker';

/**
 * Transforms string values representing booleans ('true', 'false') to actual booleans.
 * Note: Must be paired with `@Type(() => Object)` on the class property to bypass
 * class-transformer's eager casting that converts all non-empty strings (including 'false') to true.
 *
 * @param params The transform parameter object.
 * @returns The converted boolean value, or the original value if not matching.
 */
function transformToBoolean<T>({ value }: { value: T }): boolean | T {
    if (value === 'true' || value === true) {
        return true;
    }

    if (value === 'false' || value === false) {
        return false;
    }

    return value;
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
     * Flag to enable TLS for Redis Cache connection.
     */
    // @Type(() => Object) is required to prevent class-transformer from eagerly casting 'false' to true.
    @Type(() => Object)
    @Transform(transformToBoolean)
    @IsBoolean()
    readonly REDIS_CACHE_TLS!: boolean;

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
     * Flag to enable TLS for Redis State connection.
     */
    // @Type(() => Object) is required to prevent class-transformer from eagerly casting 'false' to true.
    @Type(() => Object)
    @Transform(transformToBoolean)
    @IsBoolean()
    readonly REDIS_STATE_TLS!: boolean;

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
     * Grace window (e.g. '30s') during which a just-rotated refresh token is tombstoned rather than
     * treated as reuse, so a legitimate concurrent/duplicate refresh is rejected as a benign conflict
     * instead of triggering full session-family revocation.
     */
    @IsString()
    @Matches(/^\d+[smhd]$/, {
        message:
            'SESSION_ROTATION_GRACE_TTL must match the format: duration followed by s, m, h, or d (e.g., "30s", "1m")',
    })
    readonly SESSION_ROTATION_GRACE_TTL!: string;

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
     * Time-to-live (TTL) window in milliseconds for the critical rate limiter.
     */
    @IsNumber()
    readonly THROTTLE_CRITICAL_TTL!: number;

    /**
     * Maximum number of requests allowed within the defined THROTTLE_CRITICAL_TTL window.
     */
    @IsNumber()
    readonly THROTTLE_CRITICAL_LIMIT!: number;

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

    /**
     * Sentry DSN (Data Source Name) for error tracking.
     */
    @IsString()
    readonly SENTRY_DSN!: string;

    /**
     * Sentry environment (e.g. production, staging, development).
     */
    @IsEnum(TrackerEnvironment)
    readonly SENTRY_ENVIRONMENT!: TrackerEnvironment;

    /**
     * OpenTelemetry traces exporter endpoint.
     */
    @IsString()
    readonly OTEL_EXPORTER_OTLP_TRACES_ENDPOINT!: string;

    /**
     * OpenTelemetry metrics exporter endpoint.
     */
    @IsString()
    readonly OTEL_EXPORTER_OTLP_METRICS_ENDPOINT!: string;

    /**
     * OpenTelemetry service name.
     */
    @IsString()
    readonly OTEL_SERVICE_NAME!: string;
}

/**
 * Transforms incoming raw environment variables into the `EnvironmentVariables` class and validates them.
 * Throws an error to prevent application startup if any validation constraints fail.
 *
 * @param config Raw object containing environment variables (typically process.env).
 * @returns Validated and typed environment variables instance.
 * @throws {Error} containing validation failure details if any environment variable is missing or invalid.
 */
export function validateConfig(config: Record<string, unknown>): EnvironmentVariables {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, {
            enableImplicitConversion: true,
        }),
        errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }

    return validatedConfig;
}
