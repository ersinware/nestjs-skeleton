/**
 * @file env.validation.ts
 * @description Boot-time environment validation and conversion.
 */

import { applyDecorators } from '@nestjs/common';
import { plainToInstance, Transform } from 'class-transformer';
import {
    IsBoolean,
    IsByteLength,
    IsEmail,
    IsEnum,
    isFQDN,
    IsIn,
    IsInt,
    isIP,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    IsUrl,
    Matches,
    Max,
    Min,
    ValidateBy,
    ValidateIf,
    validateSync,
} from 'class-validator';
import { parseTtlToSeconds } from 'src/core/config/duration.util';
import { ENV } from 'src/core/config/environment/env.constant';
import { Environment } from 'src/core/config/environment/node-env.enum';
import { ExceptionTrackerEnvironment } from 'src/core/observability/exception-tracker';

/**
 * Accepts `false` or named/IP/CIDR proxy lists, never hop counts: proxy-chain changes can
 * otherwise change which client address is trusted. Address validity is checked separately.
 */
export const TRUST_PROXY_PATTERN =
    /^(?:false|(?:[\da-fA-F.:]+(?:\/\d{1,3})?|loopback|linklocal|uniquelocal)(?:\s*,\s*(?:[\da-fA-F.:]+(?:\/\d{1,3})?|loopback|linklocal|uniquelocal))*)$/;

/**
 * Maximum seconds representable by PostgreSQL and Node timers in signed 32-bit milliseconds.
 */
const MAX_TIMER_SECONDS = 2_147_483_647 / 1000;

/**
 * Parses decimal environment numbers without coercing blanks or booleans to zero/one.
 * Integer-only contracts reject fractional values after parsing.
 *
 * @param integer Whether the consumer requires a whole number.
 * @returns Numeric conversion and validation decorators.
 */
function IsEnvNumber(integer = false): PropertyDecorator {
    return applyDecorators(
        Transform(({ value }: { readonly value: unknown }) =>
            typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
                ? Number(value)
                : value,
        ),
        integer ? IsInt() : IsNumber(),
    );
}

/**
 * Validates trusted proxy IPs, CIDR prefix lengths, and named ranges; accepts false to disable trust.
 *
 * @returns Trusted proxy list validation decorator.
 */
function IsTrustedProxyList(): PropertyDecorator {
    return ValidateBy({
        name: 'isTrustedProxyList',
        validator: {
            validate: (value: unknown) =>
                typeof value === 'string' &&
                (value === 'false' ||
                    value.split(',').every((entry) => {
                        const token = entry.trim();

                        if (['loopback', 'linklocal', 'uniquelocal'].includes(token)) {
                            return true;
                        }

                        const [address, prefix, extra] = token.split('/');

                        if (!address || !isIP(address) || extra !== undefined) {
                            return false;
                        }

                        return (
                            prefix === undefined ||
                            (/^\d+$/.test(prefix) && Number(prefix) <= (isIP(address, 4) ? 32 : 128))
                        );
                    })),
            defaultMessage: () => '$property must contain valid IP addresses, CIDRs, or named ranges',
        },
    });
}

/**
 * Treats an empty optional environment value as unset.
 *
 * @param params Transform input containing the raw value.
 * @returns Undefined for an empty string; otherwise the original value.
 */
function emptyToUndefined<T>({ value }: { readonly value: T }): T | undefined {
    return value === '' ? undefined : value;
}

/**
 * Validates a Redis host without accepting URLs, ports, or malformed numeric IP addresses.
 *
 * @returns Hostname or IP validation decorator.
 */
function IsRedisHost(): PropertyDecorator {
    return ValidateBy({
        name: 'isRedisHost',
        validator: {
            validate: (value: unknown) =>
                typeof value === 'string' &&
                (isIP(value) ||
                    (!/^[\d.]+$/.test(value) && isFQDN(value, { require_tld: false, allow_underscores: true }))),
            defaultMessage: () => '$property must be a hostname or IP address, without a scheme or port',
        },
    });
}

/**
 * Accepts only explicit true/false environment values.
 *
 * @returns The composed property decorator.
 */
function IsEnvBoolean(): PropertyDecorator {
    return applyDecorators(Transform(transformToBoolean), IsBoolean());
}

/**
 * Converts recognized boolean strings and leaves invalid values for validation.
 *
 * @param params Transform input containing the raw value.
 * @returns A boolean for recognized values; otherwise the original value.
 */
function transformToBoolean<T>({ value }: { readonly value: T }): boolean | T {
    if (value === 'true' || value === true) {
        return true;
    }

    if (value === 'false' || value === false) {
        return false;
    }

    return value;
}

/**
 * Validates a positive JWT lifetime with an explicit seconds, minutes, hours, or days suffix.
 *
 * @returns JWT lifetime validation decorator.
 */
function IsJwtTtl(): PropertyDecorator {
    return applyDecorators(
        IsString(),
        ValidateBy({
            name: 'isJwtTtl',
            validator: {
                validate: (value: unknown): boolean => {
                    if (typeof value !== 'string' || !/^(\d+)([smhd])$/.test(value)) return false;

                    const seconds = parseTtlToSeconds(value);

                    return (
                        Number.isSafeInteger(seconds) &&
                        seconds > 0 &&
                        Number.isSafeInteger((Math.floor(Date.now() / 1000) + seconds) * 1000)
                    );
                },
                defaultMessage: () =>
                    '$property must be a positive duration with an s/m/h/d suffix and a safely representable millisecond expiry',
            },
        }),
    );
}

/**
 * Validates an absolute HTTP/HTTPS URL, including localhost and internal hostnames.
 *
 * @returns HTTP URL validation decorator.
 */
function IsHttpUrl(): PropertyDecorator {
    return IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false });
}

/**
 * Validated application environment.
 */
export class EnvironmentVariables {
    /**
     * The port number on which the application will listen.
     */
    @IsEnvNumber(true)
    @Min(1)
    @Max(65535)
    readonly PORT!: number;

    /**
     * The environment in which the application runs.
     */
    @IsEnum(Environment)
    readonly NODE_ENV!: Environment;

    /**
     * Trusted proxy addresses or `false`; unrestricted trust would let clients spoof their IP.
     * Hop counts are excluded because proxy-chain changes alter which address is trusted.
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
    @IsTrustedProxyList()
    readonly TRUST_PROXY!: string;

    /**
     * Connection URL of the primary (writer) PostgreSQL endpoint.
     */
    @IsString()
    @IsUrl({ protocols: ['postgres', 'postgresql'], require_protocol: true, require_tld: false })
    readonly DATABASE_URL!: string;

    /**
     * Connection URL of the read-replica (reader) PostgreSQL endpoint. Unset or empty means no
     * replica: replica-bound reads then run on the primary.
     */
    @Transform(emptyToUndefined)
    @IsOptional()
    @IsString()
    @IsUrl({ protocols: ['postgres', 'postgresql'], require_protocol: true, require_tld: false })
    readonly DATABASE_REPLICA_URL?: string;

    /**
     * Maximum number of connections in the primary pool per process.
     */
    @IsEnvNumber(true)
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    readonly DATABASE_POOL_SIZE!: number;

    /**
     * Replica pool limit per process; defaults to DATABASE_POOL_SIZE when omitted.
     */
    @IsOptional()
    @IsEnvNumber(true)
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    readonly DATABASE_REPLICA_POOL_SIZE?: number;

    /**
     * Maximum wait in seconds to acquire or establish a database connection.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly DATABASE_CONNECT_TIMEOUT!: number;

    /**
     * PostgreSQL statement execution limit in seconds, including lock waits.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly DATABASE_STATEMENT_TIMEOUT!: number;

    /**
     * Client query wait limit in seconds; allow time beyond the statement limit for its response.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly DATABASE_QUERY_TIMEOUT!: number;

    /**
     * Idle timeout in seconds for database connections to be terminated.
     */
    @IsEnvNumber()
    @Min(0)
    @Max(MAX_TIMER_SECONDS)
    readonly DATABASE_IDLE_TIMEOUT!: number;

    /**
     * Maximum lifetime of a database connection in seconds.
     */
    @IsEnvNumber()
    @Min(0)
    @Max(MAX_TIMER_SECONDS)
    readonly DATABASE_MAX_LIFETIME!: number;

    /**
     * Maximum number of connections in the independent pg-boss pool per process.
     */
    @IsEnvNumber(true)
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    readonly JOB_QUEUE_POOL_SIZE!: number;

    /**
     * Enables DLQ sampling and gauges only on instances assigned to monitoring.
     */
    @IsEnvBoolean()
    readonly JOB_QUEUE_DLQ_MONITOR_ENABLED!: boolean;

    /**
     * Interval in seconds between completed dead-letter monitoring samples.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly JOB_QUEUE_DLQ_SAMPLE_INTERVAL!: number;

    /**
     * Hostname or IP address of the Redis Cache server.
     */
    @IsString()
    @IsRedisHost()
    readonly REDIS_CACHE_HOST!: string;

    /**
     * Port number on which the Redis Cache server is listening.
     */
    @IsEnvNumber(true)
    @Min(1)
    @Max(65535)
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
     * Maximum number of Redis cache reconnection retries per request.
     */
    @IsEnvNumber(true)
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    readonly REDIS_CACHE_MAX_RETRIES_PER_REQUEST!: number;

    /**
     * Redis cache command execution timeout in seconds.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly REDIS_CACHE_COMMAND_TIMEOUT!: number;

    /**
     * Hostname or IP address of the Redis session store server.
     */
    @IsString()
    @IsRedisHost()
    readonly REDIS_SESSION_HOST!: string;

    /**
     * Port number on which the Redis session store server is listening.
     */
    @IsEnvNumber(true)
    @Min(1)
    @Max(65535)
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
     * Maximum number of Redis session reconnection retries per request.
     */
    @IsEnvNumber(true)
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    readonly REDIS_SESSION_MAX_RETRIES_PER_REQUEST!: number;

    /**
     * Redis session command execution timeout in seconds.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly REDIS_SESSION_COMMAND_TIMEOUT!: number;

    /**
     * Maximum administrator login lifetime, independent of refresh activity.
     */
    @IsJwtTtl()
    readonly SESSION_ABSOLUTE_TTL_ADMIN!: string;

    /**
     * Maximum end-user login lifetime, independent of refresh activity.
     */
    @IsJwtTtl()
    readonly SESSION_ABSOLUTE_TTL_USER!: string;

    /**
     * 1–60 second replay grace: conflicts are audited without family revocation.
     * Timing alone cannot establish whether a replay is legitimate.
     */
    @IsString()
    @ValidateBy({
        name: 'isRotationGraceTtl',
        validator: {
            validate: (value: unknown): boolean => {
                const match = typeof value === 'string' ? /^(\d+)([smhd])$/.exec(value) : null;

                if (!match) {
                    return false;
                }

                const unitSeconds: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400 },
                    seconds = Number(match[1]) * unitSeconds[match[2]!]!;

                return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 60;
            },
            defaultMessage: () =>
                '$property must be a duration from 1 to 60 seconds with an s/m/h/d suffix (e.g., "30s", "1m")',
        },
    })
    readonly SESSION_ROTATION_GRACE_TTL!: string;

    /**
     * Secret key for signing JWT access tokens.
     */
    @IsString()
    @Matches(/\S/)
    @IsByteLength(32)
    readonly JWT_ACCESS_SECRET!: string;

    /**
     * Time-to-live for JWT access tokens (e.g., '15m').
     */
    @IsJwtTtl()
    readonly JWT_ACCESS_TTL!: string;

    /**
     * Secret key for signing JWT refresh tokens.
     */
    @IsString()
    @Matches(/\S/)
    @IsByteLength(32)
    readonly JWT_REFRESH_SECRET!: string;

    /**
     * Time-to-live for JWT refresh tokens (e.g., '7d').
     */
    @IsJwtTtl()
    readonly JWT_REFRESH_TTL!: string;

    /**
     * Secret key for signing JWT invite tokens.
     */
    @IsString()
    @Matches(/\S/)
    @IsByteLength(32)
    readonly JWT_INVITE_SECRET!: string;

    /**
     * Base URL of the admin activation page; the invite email appends the token as a query parameter.
     */
    @IsString()
    @IsHttpUrl()
    readonly ADMIN_INVITE_URL!: string;

    /**
     * Separate secret for signing user activation tokens.
     */
    @IsString()
    @Matches(/\S/)
    @IsByteLength(32)
    readonly JWT_USER_ACTIVATION_SECRET!: string;

    /**
     * Frontend page receiving user activation links.
     */
    @IsString()
    @IsHttpUrl()
    readonly USER_ACTIVATION_URL!: string;

    /**
     * Separate secret for signing upload proofs.
     */
    @IsString()
    @Matches(/\S/)
    @IsByteLength(32)
    readonly JWT_UPLOAD_SECRET!: string;

    /**
     * Separate secret for signing email confirmation tokens.
     */
    @IsString()
    @Matches(/\S/)
    @IsByteLength(32)
    readonly JWT_EMAIL_CONFIRM_SECRET!: string;

    /**
     * Frontend page receiving admin email confirmation links.
     */
    @IsString()
    @IsHttpUrl()
    readonly ADMIN_EMAIL_CONFIRM_URL!: string;

    /**
     * Frontend page receiving user email confirmation links.
     */
    @IsString()
    @IsHttpUrl()
    readonly USER_EMAIL_CONFIRM_URL!: string;

    /**
     * Heap memory limit (in MB) for system health checks.
     */
    @IsEnvNumber()
    @IsPositive()
    readonly HEALTH_HEAP_LIMIT_MB!: number;

    /**
     * Resident Set Size (RSS) limit (in MB) for system health checks.
     */
    @IsEnvNumber()
    @IsPositive()
    readonly HEALTH_RSS_LIMIT_MB!: number;

    /**
     * Bucket used for server-owned object keys.
     */
    @IsString()
    @Matches(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    readonly STORAGE_BUCKET!: string;

    /**
     * Region used for S3 request signing.
     */
    @IsString()
    @Matches(/^[a-z0-9-]+$/)
    readonly STORAGE_REGION!: string;

    /**
     * Optional S3-compatible endpoint for local development and tests.
     */
    @Transform(emptyToUndefined)
    @IsOptional()
    @IsString()
    @IsHttpUrl()
    readonly STORAGE_ENDPOINT?: string;

    /**
     * Maximum time in seconds to establish an S3 connection.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly STORAGE_CONNECT_TIMEOUT!: number;

    /**
     * Maximum time in seconds for an S3 request.
     */
    @IsEnvNumber()
    @Min(0.001)
    @Max(MAX_TIMER_SECONDS)
    readonly STORAGE_REQUEST_TIMEOUT!: number;

    /**
     * Verified sender address for transactional email.
     */
    @IsString()
    @IsEmail()
    readonly EMAIL_FROM_ADDRESS!: string;

    /**
     * API credential for the configured email provider.
     */
    @IsString()
    @Matches(/\S/)
    readonly EMAIL_API_KEY!: string;

    /**
     * Sentry DSN (Data Source Name) for error tracking; empty disables Sentry initialization.
     */
    @ValidateIf((_object, value: unknown) => value !== '')
    @IsString()
    @IsHttpUrl()
    @Matches(/^https?:\/\/\w+(?::\w*)?@[^/?#]+\/(?:[^?#]*\/)?\d+$/, {
        message: 'SENTRY_DSN must include a public key and numeric project ID',
    })
    readonly SENTRY_DSN!: string;

    /**
     * Sentry environment (e.g. production, staging, development).
     */
    @IsEnum(ExceptionTrackerEnvironment)
    readonly SENTRY_ENVIRONMENT!: ExceptionTrackerEnvironment;

    /**
     * Disables telemetry export for local runs without the Collector.
     */
    @IsEnvBoolean()
    readonly OTEL_SDK_DISABLED!: boolean;

    /**
     * OpenTelemetry traces exporter endpoint.
     */
    @IsString()
    @IsHttpUrl()
    readonly OTEL_EXPORTER_OTLP_TRACES_ENDPOINT!: string;

    /**
     * OpenTelemetry metrics exporter endpoint.
     */
    @IsString()
    @IsHttpUrl()
    readonly OTEL_EXPORTER_OTLP_METRICS_ENDPOINT!: string;

    /**
     * OpenTelemetry service name.
     */
    @IsString()
    @Matches(/\S/)
    readonly OTEL_SERVICE_NAME!: string;

    /**
     * OTel resource attributes, including service namespace and deployment environment.
     */
    @IsString()
    @Matches(/^[^\s=,]+=[^,]*(?:,[^\s=,]+=[^,]*)*$/)
    readonly OTEL_RESOURCE_ATTRIBUTES!: string;

    /**
     * Resource detectors, with serviceinstance last to preserve its generated ID.
     */
    @IsIn(['env,host,process,serviceinstance'])
    readonly OTEL_NODE_RESOURCE_DETECTORS!: string;

    /**
     * HTTP semantic convention mode; controls emitted span and metric names.
     */
    @IsIn(['http', 'http/dup'])
    readonly OTEL_SEMCONV_STABILITY_OPT_IN!: string;
}

/**
 * Converts and validates the boot environment.
 *
 * @param config Raw environment values.
 * @returns Validated environment values.
 * @throws {Error} When configuration is missing or invalid.
 */
export function validateConfig(config: Record<string, unknown>): EnvironmentVariables {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, {
            enableImplicitConversion: false,
        }),
        errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }

    // Session records expire with refresh credentials and must cover the access lifetime.
    if (parseTtlToSeconds(validatedConfig.JWT_REFRESH_TTL) < parseTtlToSeconds(validatedConfig.JWT_ACCESS_TTL)) {
        throw new Error(`${ENV.JWT_REFRESH_TTL} must be greater than or equal to ${ENV.JWT_ACCESS_TTL}.'`);
    }

    return validatedConfig;
}
