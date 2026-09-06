/**
 * @file health-indicator-schema.util.ts
 * @description Shared OpenAPI schema vocabulary for the health indicators, so the documented indicator set cannot drift between the two response DTOs.
 */

import { HealthIndicatorKey, HealthyIndicatorState } from 'src/module/health/application/query/get-health-status/query';

/**
 * Swagger description of each indicator; a new indicator fails compilation here until documented.
 */
export const HealthIndicatorDescription = {
    memory_heap: 'Heap memory usage indicator status.',
    memory_rss: 'Resident set size memory usage indicator status.',
    database: 'Database (primary) connection indicator status.',
    database_replica: 'Database read-replica connection indicator status; the primary when no replica is configured.',
    cache: 'Cache connection indicator status.',
    session: 'Session store connection indicator status.',
} as const satisfies Record<HealthIndicatorKey, string>;

/**
 * Builds the Swagger properties map documenting every indicator in its healthy state.
 *
 * @returns A properties object with one healthy-indicator schema per vocabulary key
 */
export function createHealthyIndicatorProperties(): Record<HealthIndicatorKey, Record<string, unknown>> {
    return {
        memory_heap: createHealthyIndicator(HealthIndicatorDescription.memory_heap),
        memory_rss: createHealthyIndicator(HealthIndicatorDescription.memory_rss),
        database: createHealthyIndicator(HealthIndicatorDescription.database),
        database_replica: createHealthyIndicator(HealthIndicatorDescription.database_replica),
        cache: createHealthyIndicator(HealthIndicatorDescription.cache),
        session: createHealthyIndicator(HealthIndicatorDescription.session),
    };
}

/**
 * Builds the schema of one healthy indicator.
 *
 * @param description The indicator's description
 * @returns The healthy-indicator schema
 */
function createHealthyIndicator(description: string): Record<string, unknown> {
    return {
        type: 'object',
        required: ['status'],
        description,
        properties: {
            status: {
                type: 'string',
                description: 'Indicator status',
                example: 'up',
                enum: ['up'],
                minLength: 2,
                maxLength: 2,
            },
        },
        additionalProperties: false,
        minProperties: 1,
        maxProperties: 1,
        example: { status: 'up' } satisfies HealthyIndicatorState,
    };
}
