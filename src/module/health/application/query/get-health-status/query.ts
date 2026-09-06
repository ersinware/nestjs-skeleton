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
} as const satisfies Record<HealthIndicatorKey, string>;

/**
 * State of a healthy indicator.
 */
export type HealthyIndicatorState = {
    status: 'up';
};

/**
 * Read model of a fully healthy system.
 */
type HealthyReadModel = {
    status: 'ok';
    info: Record<HealthIndicatorKey, HealthyIndicatorState>;
    error: Record<string, never>;
    details: Record<HealthIndicatorKey, HealthyIndicatorState>;
};

/**
 * State of an unhealthy indicator; the message names the failure.
 */
export type UnhealthyIndicatorState = {
    status: 'down';
    message: string;
};

/**
 * State of an indicator in either condition; the message is present only when down.
 */
export type HealthyOrUnhealthyIndicatorState = {
    status: 'up' | 'down';
    message?: string;
};

/**
 * Read model of a system with at least one failed indicator.
 */
type UnhealthyReadModel = {
    status: 'error';
    info: Partial<Record<HealthIndicatorKey, HealthyIndicatorState>>;
    error: Partial<Record<HealthIndicatorKey, UnhealthyIndicatorState>>;
    details: Record<HealthIndicatorKey, HealthyOrUnhealthyIndicatorState>;
};

/**
 * Result of the GetHealthStatusQuery.
 */
export type GetHealthStatusResult = HealthyReadModel | UnhealthyReadModel;
