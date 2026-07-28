/**
 * @file query.ts
 * @description Defines the query for checking system health status.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Query to check the health status of the application including memory, database, and cache.
 */
export class GetHealthStatusQuery extends Query<GetHealthStatusResult> {}

/**
 * State representing a healthy indicator.
 */
type HealthyIndicatorState = {
    status: 'up';
};

/**
 * Read model representing a completely healthy system.
 */
type HealthyReadModel = {
    status: 'ok';
    info: {
        memory_heap: HealthyIndicatorState;
        memory_rss: HealthyIndicatorState;
        database: HealthyIndicatorState;
        cache: HealthyIndicatorState;
        state: HealthyIndicatorState;
    };
    error: Record<string, never>;
    details: {
        memory_heap: HealthyIndicatorState;
        memory_rss: HealthyIndicatorState;
        database: HealthyIndicatorState;
        cache: HealthyIndicatorState;
        state: HealthyIndicatorState;
    };
};

/**
 * State representing an unhealthy indicator, requiring a message.
 */
type UnhealthyIndicatorState = {
    status: 'down';
    message: string;
};

/**
 * Detailed state representing any indicator, which might have a message.
 */
type DetailIndicatorState = {
    status: 'up' | 'down';
    message?: string;
};

/**
 * Read model representing an unhealthy system where one or more indicators have failed.
 */
type UnhealthyReadModel = {
    status: 'error';
    info: Partial<{
        memory_heap: HealthyIndicatorState;
        memory_rss: HealthyIndicatorState;
        database: HealthyIndicatorState;
        cache: HealthyIndicatorState;
        state: HealthyIndicatorState;
    }>;
    error: Partial<{
        memory_heap: UnhealthyIndicatorState;
        memory_rss: UnhealthyIndicatorState;
        database: UnhealthyIndicatorState;
        cache: UnhealthyIndicatorState;
        state: UnhealthyIndicatorState;
    }>;
    details: {
        memory_heap: DetailIndicatorState;
        memory_rss: DetailIndicatorState;
        database: DetailIndicatorState;
        cache: DetailIndicatorState;
        state: DetailIndicatorState;
    };
};

/**
 * The expected result structure of the GetHealthStatusQuery.
 */
export type GetHealthStatusResult = HealthyReadModel | UnhealthyReadModel;
