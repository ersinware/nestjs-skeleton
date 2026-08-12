/**
 * @file env.validation.ts
 * @description Declares every environment variable's contract and validates the raw environment at
 * boot, so the application never starts with a missing or invalid variable.
 */

import { applyDecorators } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsString, Matches, Max, Min, validateSync } from 'class-validator';
import { Environment } from 'src/core/config/environment/node-env.enum';
import { ExceptionTrackerEnvironment } from 'src/core/observability/exception-tracker';

/**
 * The two shapes this application accepts: `false`, or a comma-separated list of IPv4/IPv6
 * addresses, CIDR ranges and the named presets (`loopback`, `linklocal`, `uniquelocal`).
 *
 * Fastify would also take a trusted-HOP COUNT; that form is deliberately excluded. A count is
 * positional: inserting a CDN or a service-mesh sidecar shifts which hop is believed and nothing
 * fails — the audit record's `remoteAddress` quietly starts naming the wrong party. A list names the
 * machines actually operated; a hop not on it is never believed, whatever position it arrives in.
 *
 * The pattern is otherwise shape-only — the exact address grammar is proxy-addr's to enforce, and
 * duplicating it here would be a second parser to keep in step. It only guarantees that nothing
 * outside these shapes, `true` above all, ever reaches the adapter.
 */
export const TRUST_PROXY_PATTERN =
    /^(?:false|(?:[\da-fA-F.:]+(?:\/\d{1,3})?|loopback|linklocal|uniquelocal)(?:\s*,\s*(?:[\da-fA-F.:]+(?:\/\d{1,3})?|loopback|linklocal|uniquelocal))*)$/;

/**
 * The duration shape every TTL variable must match: an integer followed by s, m, h, or d.
 */
const TTL_PATTERN = /^\d+[smhd]$/;

/**
 * Transforms the strings 'true'/'false' to actual booleans, leaving any other value untouched for
 * `@IsBoolean` to reject.
 *
 * @param params The transform parameter object.
 * @returns The converted boolean, or the original value if it is not a recognized boolean string.
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
 * Validates a boolean environment variable arriving as the string 'true'/'false'.
 *
 * Bundles the three decorators the conversion needs so no future boolean variable can forget one:
 * `@Type(() => Object)` bypasses class-transformer's eager casting that would turn every non-empty
 * string (including 'false') into `true`, `@Transform` then maps the two accepted strings to real
 * booleans, and `@IsBoolean` rejects everything else.
 *
 * @returns The composed property decorator.
 */
function IsEnvBoolean(): PropertyDecorator {
    return applyDecorators(
        Type(() => Object),
        Transform(transformToBoolean),
        IsBoolean(),
    );
}

/**
 * The contract of every environment variable the application declares, enforced with
 * `class-validator` constraints at boot.
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
     * Which reverse-proxy hops in front of the app may be believed when they claim a client's IP.
     *
     * Every downstream decision keyed on "who made this request" — today the audit record's
     * `remoteAddress`, and any IP-keyed control added later — resolves to `request.ip`, derived from the
     * client-writable `X-Forwarded-For` header; trusting it blindly hands the client its own
     * identity. Accepted values are `false` (no proxy) or a comma-separated list of proxy
     * IPs/CIDRs; both `true` and a bare hop count are rejected — see {@link TRUST_PROXY_PATTERN}.
     */
    @IsString()
    @Matches(/^(?!true$)/, {
        message:
            'TRUST_PROXY must not be "true": it would believe every hop in X-Forwarded-For, letting any client spoof its own IP and so choose the remoteAddress recorded against it. List the trusted proxy IPs/CIDRs instead.',
    })
    @Matches(TRUST_PROXY_PATTERN, {
        message:
            'TRUST_PROXY must be "false" or a comma-separated list of proxy IPs/CIDRs (loopback, linklocal and uniquelocal are also accepted). A hop count is not accepted: it silently resolves to a different hop whenever the proxy chain changes.',
    })
    readonly TRUST_PROXY!: string;

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
    @IsEnvBoolean()
    readonly REDIS_CACHE_TLS!: boolean;

    /**
     * Hostname or IP address of the Redis session store server.
     */
    @IsString()
    readonly REDIS_SESSION_HOST!: string;

    /**
     * Port number on which the Redis session store server is listening.
     */
    @IsNumber()
    readonly REDIS_SESSION_PORT!: number;

    /**
     * Password for Redis session store authentication.
     */
    @IsString()
    readonly REDIS_SESSION_PASSWORD!: string;

    /**
     * Flag to enable TLS for Redis session store connection.
     */
    @IsEnvBoolean()
    readonly REDIS_SESSION_TLS!: boolean;

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
    @Matches(TTL_PATTERN, {
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
    @Matches(TTL_PATTERN, {
        message: 'JWT_REFRESH_TTL must match the format: duration followed by s, m, h, or d (e.g., "7d", "30d")',
    })
    readonly JWT_REFRESH_TTL!: string;

    /**
     * Secret key for signing JWT invite tokens.
     */
    @IsString()
    readonly JWT_INVITE_SECRET!: string;

    /**
     * Time-to-live for JWT invite tokens (e.g., '3d').
     */
    @IsString()
    @Matches(TTL_PATTERN, {
        message: 'JWT_INVITE_TTL must match the format: duration followed by s, m, h, or d (e.g., "3d", "72h")',
    })
    readonly JWT_INVITE_TTL!: string;

    /**
     * Base URL of the admin activation page; the invite email appends the token as a query parameter.
     */
    @IsString()
    @Matches(/^https?:\/\/\S+$/, {
        message: 'ADMIN_INVITE_URL must be an absolute http(s) URL',
    })
    readonly ADMIN_INVITE_URL!: string;

    /**
     * Grace window (e.g. '30s') during which a just-rotated refresh token is tombstoned rather than
     * treated as reuse, so a legitimate concurrent/duplicate refresh is rejected as a benign conflict
     * instead of triggering full session-family revocation.
     */
    @IsString()
    @Matches(TTL_PATTERN, {
        message:
            'SESSION_ROTATION_GRACE_TTL must match the format: duration followed by s, m, h, or d (e.g., "30s", "1m")',
    })
    readonly SESSION_ROTATION_GRACE_TTL!: string;

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
    @IsEnum(ExceptionTrackerEnvironment)
    readonly SENTRY_ENVIRONMENT!: ExceptionTrackerEnvironment;

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

    /**
     * OpenTelemetry trace sampler strategy (e.g. `parentbased_traceidratio`). Read natively by the
     * OTel SDK; declared here only so an unknown value fails fast at boot instead of silently falling
     * back to the SDK default.
     */
    @IsString()
    readonly OTEL_TRACES_SAMPLER!: string;

    /**
     * Keep-ratio for the `*traceidratio` sampler: 1 records every trace, 0.1 one in ten. Ignored by
     * `always_on`/`always_off`. This is the single knob to turn down to shed trace volume at scale —
     * the access log remains the unsampled ground truth, so lowering it never loses request evidence.
     */
    @IsNumber()
    @Min(0)
    @Max(1)
    readonly OTEL_TRACES_SAMPLER_ARG!: number;
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
