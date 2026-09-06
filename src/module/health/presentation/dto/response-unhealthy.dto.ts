/**
 * @file response-unhealthy.dto.ts
 * @description Response body of a failed health check (HTTP 503), naming the failing indicators.
 */

import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
    HEALTH_INDICATOR_KEYS,
    HealthIndicatorKey,
    HealthyIndicatorState,
    HealthyOrUnhealthyIndicatorState,
    UnhealthyIndicatorMessage,
    UnhealthyIndicatorState,
} from 'src/module/health/application/query/get-health-status/query';
import {
    createHealthyIndicatorProperties,
    HealthIndicatorDescription,
} from 'src/module/health/presentation/dto/health-indicator-schema.util';

/**
 * Response body of a failed health check, mirroring the Terminus report shape.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseUnhealthy',
    description: 'Report returned when at least one health indicator fails.',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class ResponseUnhealthyDto {
    /**
     * Overall status; always "error" on this response.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        enum: ['error'],
        description: 'Overall status; always "error".',
        example: 'error',
    })
    readonly status!: 'error';

    /**
     * Per-indicator state of the components still healthy despite the overall failure.
     */
    @Expose()
    @ApiProperty(createUnhealthyInfoSchema('States of the indicators still healthy.'))
    readonly info!: Partial<Record<HealthIndicatorKey, unknown>>;

    /**
     * Per-indicator failure of the components that are down, each with its message.
     */
    @Expose()
    @ApiProperty(createUnhealthyErrorSchema('Failures of the indicators that are down.'))
    readonly error!: Partial<Record<HealthIndicatorKey, unknown>>;

    /**
     * Combined per-indicator state — the union of `info` and `error`.
     */
    @Expose()
    @ApiProperty(createUnhealthyDetailsSchema('Combined states of all indicators.'))
    readonly details!: Record<HealthIndicatorKey, unknown>;
}

/**
 * Builds the schema of the `info` block: the indicators that are still healthy.
 *
 * @param description The block's description
 * @returns The block schema
 */
function createUnhealthyInfoSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        properties: createHealthyIndicatorProperties(),
        minProperties: 0,
        maxProperties: HEALTH_INDICATOR_KEYS.length,
        additionalProperties: false,
        description,
        example: {
            memory_heap: {
                status: 'up',
            },
            memory_rss: {
                status: 'up',
            },
            session: {
                status: 'up',
            },
        } satisfies Partial<Record<HealthIndicatorKey, HealthyIndicatorState>>,
    };
}

/**
 * Builds the schema of the `error` block: the indicators that are down.
 *
 * @param description The block's description
 * @returns The block schema
 */
function createUnhealthyErrorSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        properties: Object.fromEntries(HEALTH_INDICATOR_KEYS.map((key) => [key, createUnhealthyIndicator(key)])),
        additionalProperties: false,
        description,
        example: {
            database: {
                status: 'down',
                message: UnhealthyIndicatorMessage.database,
            },
            database_replica: {
                status: 'down',
                message: UnhealthyIndicatorMessage.database_replica,
            },
            cache: {
                status: 'down',
                message: UnhealthyIndicatorMessage.cache,
            },
        } satisfies Partial<Record<HealthIndicatorKey, UnhealthyIndicatorState>>,
    };
}

/**
 * Builds the schema of one down indicator.
 *
 * @param key The indicator being documented
 * @returns The down-indicator schema
 */
function createUnhealthyIndicator(key: HealthIndicatorKey): Record<string, unknown> {
    const exampleMessage = UnhealthyIndicatorMessage[key];

    return {
        type: 'object',
        required: ['status', 'message'],
        properties: {
            status: {
                type: 'string',
                enum: ['down'],
                minLength: 4,
                maxLength: 4,
                description: 'Indicator status',
                example: 'down',
            },
            message: {
                type: 'string',
                minLength: 1,
                description: 'Failure message.',
                example: exampleMessage,
            },
        },
        additionalProperties: false,
        description: HealthIndicatorDescription[key],
        example: { status: 'down', message: exampleMessage } satisfies UnhealthyIndicatorState,
    };
}

/**
 * Builds the schema of the `details` block: every indicator in either state.
 *
 * @param description The block's description
 * @returns The block schema
 */
function createUnhealthyDetailsSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        required: [...HEALTH_INDICATOR_KEYS],
        properties: {
            memory_heap: createHealthyOrUnhealthyIndicator('memory_heap', 'up'),
            memory_rss: createHealthyOrUnhealthyIndicator('memory_rss', 'up'),
            database: createHealthyOrUnhealthyIndicator('database', 'down'),
            database_replica: createHealthyOrUnhealthyIndicator('database_replica', 'down'),
            cache: createHealthyOrUnhealthyIndicator('cache', 'down'),
            session: createHealthyOrUnhealthyIndicator('session', 'up'),
        },
        additionalProperties: false,
        minProperties: HEALTH_INDICATOR_KEYS.length,
        maxProperties: HEALTH_INDICATOR_KEYS.length,
        description,
        example: {
            memory_heap: { status: 'up' },
            memory_rss: { status: 'up' },
            session: { status: 'up' },
            database: {
                status: 'down',
                message: UnhealthyIndicatorMessage.database,
            },
            database_replica: {
                status: 'down',
                message: UnhealthyIndicatorMessage.database_replica,
            },
            cache: {
                status: 'down',
                message: UnhealthyIndicatorMessage.cache,
            },
        } satisfies Record<HealthIndicatorKey, HealthyOrUnhealthyIndicatorState>,
    };
}

/**
 * Builds the schema of one indicator that may be up or down.
 *
 * @param key The indicator being documented
 * @param exampleStatus The status shown in the example
 * @returns The indicator schema
 */
function createHealthyOrUnhealthyIndicator(
    key: HealthIndicatorKey,
    exampleStatus: 'up' | 'down',
): Record<string, unknown> {
    const exampleMessage = UnhealthyIndicatorMessage[key];

    return {
        type: 'object',
        required: ['status'],
        properties: {
            status: {
                type: 'string',
                enum: ['up', 'down'],
                minLength: 2,
                maxLength: 4,
                description: 'Indicator status',
                example: exampleStatus,
            },
            message: {
                type: 'string',
                minLength: 1,
                description: 'Failure message.',
                example: exampleMessage,
            },
        },
        additionalProperties: false,
        description: HealthIndicatorDescription[key],
        example: { status: exampleStatus, message: exampleMessage } satisfies HealthyOrUnhealthyIndicatorState,
    };
}
