/**
 * @file env.validation.ts
 * @description Declares every environment variable's contract and validates the raw environment at
 * boot, so the application never starts with a missing or invalid variable.
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
 * This pattern checks list syntax; the property validator also checks IP addresses and CIDR
 * prefix lengths before the value reaches proxy-addr.
 */
export const TRUST_PROXY_PATTERN =
    /^(?:false|(?:[\da-fA-F.:]+(?:\/\d{1,3})?|loopback|linklocal|uniquelocal)(?:\s*,\s*(?:[\da-fA-F.:]+(?:\/\d{1,3})?|loopback|linklocal|uniquelocal))*)$/;

/** Maximum seconds representable by PostgreSQL and Node timers in signed 32-bit milliseconds. */
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
        Transform(({ value }: { value: unknown }) =>
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
 * Maps an empty string to `undefined`, so an optional variable left as `NAME=` in an env file counts
 * as unset — `@IsOptional` skips `undefined`, not ''.
 *
 * @param params The transform parameter object.
 * @returns `undefined` for an empty string, the original value otherwise.
 */
function emptyToUndefined<T>({ value }: { value: T }): T | undefined {
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
 * Validates a boolean environment variable arriving as the string 'true'/'false'.
 *
 * Converts only the two explicit boolean strings; validation rejects every other value.
 *
 * @returns The composed property decorator.
 */
function IsEnvBoolean(): PropertyDecorator {
    return applyDecorators(Transform(transformToBoolean), IsBoolean());
}

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
 * Validates a positive JWT lifetime with an explicit seconds, minutes, hours, or days suffix.
 *
 * @returns JWT lifetime validation decorator.
 */
function IsJwtTtl(): PropertyDecorator {
    return applyDecorators(
        IsString(),
        Matches(/^0*[1-9]\d*[smhd]$/, {
            message: '$property must be a positive duration followed by s, m, h, or d (e.g., "15m", "7d")',
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
 * The contract of every environment variable the application declares, enforced with
 * `class-validator` constraints at boot.
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
     * Maximum number of connections in the database connection pool.
     */
    @IsEnvNumber(true)
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    readonly DATABASE_POOL_SIZE!: number;

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
     * Time-to-live for JWT invite tokens (e.g., '3d').
     */
    @IsJwtTtl()
    readonly JWT_INVITE_TTL!: string;

    /**
     * Base URL of the admin activation page; the invite email appends the token as a query parameter.
     */
    @IsString()
    @IsHttpUrl()
    readonly ADMIN_INVITE_URL!: string;

    /**
     * Grace window (e.g. '10s') during which replay of a just-rotated refresh token is audited and
     * rejected as a conflict without full session-family revocation. Timing cannot prove legitimacy.
     * Limited to 1–60 seconds: Redis requires positive expiry and longer grace delays reuse remediation.
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

                const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 },
                    seconds = Number(match[1]) * unitSeconds[match[2]!]!;

                return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 60;
            },
            defaultMessage: () =>
                '$property must be a duration from 1 to 60 seconds with an s/m/h/d suffix (e.g., "30s", "1m")',
        },
    })
    readonly SESSION_ROTATION_GRACE_TTL!: string;

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
     * Sender email address for Gmail API.
     */
    @IsString()
    @IsEmail()
    readonly GMAIL_USER_EMAIL!: string;

    /**
     * Google OAuth2 client ID for Gmail API.
     */
    @IsString()
    @Matches(/\S/)
    readonly GMAIL_CLIENT_ID!: string;

    /**
     * Google OAuth2 client secret for Gmail API.
     */
    @IsString()
    @Matches(/\S/)
    readonly GMAIL_CLIENT_SECRET!: string;

    /**
     * Google OAuth2 refresh token for Gmail API.
     */
    @IsString()
    @Matches(/\S/)
    readonly GMAIL_REFRESH_TOKEN!: string;

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
     * Comma-separated `key=value` resource attributes (`service.namespace`,
     * `deployment.environment.name`). Read natively by the OTel SDK; declared here so a missing value
     * fails at boot instead of leaving the telemetry unlabelled.
     */
    @IsString()
    @Matches(/^[^\s=,]+=[^,]*(?:,[^\s=,]+=[^,]*)*$/)
    readonly OTEL_RESOURCE_ATTRIBUTES!: string;

    /**
     * Preserves resource detection and generates a unique instance ID on every SDK startup.
     * Keep serviceinstance last so a static environment attribute cannot override its UUID.
     */
    @IsIn(['env,host,process,serviceinstance'])
    readonly OTEL_NODE_RESOURCE_DETECTORS!: string;

    /**
     * Semantic-convention generation the HTTP instrumentation emits: `http` for the stable names
     * (`http.route`, `http_server_request_duration_seconds`), `http/dup` for both during a migration.
     * Read natively by the OTel SDK; declared so the metric names cannot silently change per env.
     */
    @IsIn(['http', 'http/dup'])
    readonly OTEL_SEMCONV_STABILITY_OPT_IN!: string;
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
            enableImplicitConversion: false,
        }),
        errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }

    return validatedConfig;
}
