/**
 * @file query.ts
 * @description The health status query, its read model, and the indicator vocabulary the result is keyed by.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Query returning the per-indicator health report of the service and its dependencies.
 */
export class GetHealthStatusQuery extends Query<GetHealthStatusResult> {}

/**
 * Every indicator the query reports on. Single source of the indicator names: the adapter produces
 * the report under these keys and the Swagger schemas document them, so the two cannot drift.
 */
export const HEALTH_INDICATOR_KEYS = [
    'memory_heap',
    'memory_rss',
    'database',
    'database_replica',
    'cache',
    'session',
    'rate_limit',
] as const;

/**
 * One indicator name from the vocabulary.
 */
export type HealthIndicatorKey = (typeof HEALTH_INDICATOR_KEYS)[number];

/**
 * The failure message of each indicator. Single source shared by the adapter (which produces it)
 * and the Swagger schemas (which document it as the example).
 */
export const UnhealthyIndicatorMessage = {
    memory_heap: 'Heap memory usage exceeded the limit.',
    memory_rss: 'RSS memory usage exceeded the limit.',
    database: 'Database connection failed.',
    database_replica: 'Database replica connection failed.',
    cache: 'Cache connection failed.',
    session: 'Session store connection failed.',
    rate_limit: 'Rate-limit store connection failed.',
} as const satisfies Record<HealthIndicatorKey, string>;

/**
 * State of a healthy indicator.
 */
export type HealthyIndicatorState = {
    /**
     * Marks this indicator as healthy.
     */
    readonly status: 'up';
};

/**
 * Read model of a fully healthy system.
 */
type HealthyReadModel = {
    /**
     * Reports that every indicator is healthy.
     */
    readonly status: 'ok';

    /**
     * Healthy state of every reported indicator.
     */
    readonly info: Readonly<Record<HealthIndicatorKey, HealthyIndicatorState>>;

    /**
     * Empty failure map for a fully healthy report.
     */
    readonly error: Readonly<Record<string, never>>;

    /**
     * Complete per-indicator state for the report.
     */
    readonly details: Readonly<Record<HealthIndicatorKey, HealthyIndicatorState>>;
};

/**
 * State of an unhealthy indicator; the message names the failure.
 */
export type UnhealthyIndicatorState = {
    /**
     * Marks this indicator as unhealthy.
     */
    readonly status: 'down';

    /**
     * Diagnostic reason this indicator failed.
     */
    readonly message: string;
};

/**
 * State of an indicator in either condition; the message is present only when down.
 */
export type HealthyOrUnhealthyIndicatorState = {
    /**
     * Health state of this indicator.
     */
    readonly status: 'up' | 'down';

    /**
     * Diagnostic reason when this indicator is down.
     */
    readonly message?: string;
};

/**
 * Read model of a system with at least one failed indicator.
 */
type UnhealthyReadModel = {
    /**
     * Reports that at least one indicator failed.
     */
    readonly status: 'error';

    /**
     * Healthy indicators present in this report.
     */
    readonly info: Readonly<Partial<Record<HealthIndicatorKey, HealthyIndicatorState>>>;

    /**
     * Failed indicators and their diagnostic states.
     */
    readonly error: Readonly<Partial<Record<HealthIndicatorKey, UnhealthyIndicatorState>>>;

    /**
     * Complete healthy and failed indicator states.
     */
    readonly details: Readonly<Record<HealthIndicatorKey, HealthyOrUnhealthyIndicatorState>>;
};

/**
 * Result of the GetHealthStatusQuery.
 */
export type GetHealthStatusResult = HealthyReadModel | UnhealthyReadModel;
