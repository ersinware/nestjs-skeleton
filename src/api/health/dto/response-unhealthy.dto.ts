/**
 * @file response-unhealthy.dto.ts
 * @description Defines the exact data structure returned when one or more system health checks fail. It provides strict typing and Swagger documentation for HTTP 503 Service Unavailable health responses, helping operators quickly identify the failing component.
 */

import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Equals, IsObject, IsString } from 'class-validator';
import { createHealthyIndicator } from './util/dto.util';

/**
 * Data transfer object representing an unhealthy application status response.
 * Maps out the exact payload so external monitors can parse what went wrong.
 */
@ApiSchema({
    name: 'ResponseUnhealthy',
    description: 'Unhealthy health check response status',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class ResponseUnhealthyDto {
    /**
     * The overall status indicating the app is unhealthy.
     * Always set to "error" to allow external systems to immediately recognize a failure state.
     */
    @IsString()
    @Equals('error', { message: 'Status must be exactly "error".' })
    @ApiProperty({
        type: 'string',
        enum: ['error'],
        description: 'The overall health status indicating failure.',
        example: 'error',
    })
    readonly status!: string;

    /**
     * Contains detailed information about indicators that are currently healthy.
     * Useful for understanding which parts of the system are still functioning despite the overall failure.
     */
    @IsObject({ message: 'Info must be an object.' })
    @ApiProperty(createUnhealthyInfoSchema('Information about healthy indicators.'))
    readonly info!: Record<string, unknown>;

    /**
     * Contains detailed failure information about indicators that are currently down.
     * Essential for debugging and identifying exactly which dependency triggered the unhealthy status.
     */
    @IsObject({ message: 'Error must be an object.' })
    @ApiProperty(createUnhealthyErrorSchema('Information about indicators that failed.'))
    readonly error!: Record<string, unknown>;

    /**
     * Combined map of all indicators containing their current status and error messages if down.
     * Provides a consolidated view of all tested systems in one object for comprehensive monitoring.
     */
    @IsObject({ message: 'Details must be an object.' })
    @ApiProperty(createUnhealthyDetailsSchema('Combined details of all health indicators.'))
    readonly details!: Record<string, unknown>;
}

/**
 * Generates the Swagger schema definition for the 'info' block under unhealthy responses.
 * Contains only properties that are currently healthy. Abstracts schema definition logic to improve readability.
 *
 * @param description The detailed description to be attached to the schema block
 * @returns A Swagger schema definition object mapping healthy properties
 */
function createUnhealthyInfoSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            memory_heap: createHealthyIndicator('Heap memory usage indicator status.'),
            memory_rss: createHealthyIndicator('Resident set size memory usage indicator status.'),
            database: createHealthyIndicator('Database connection indicator status.'),
            cache: createHealthyIndicator('Cache connection indicator status.'),
        },
        minProperties: 0,
        maxProperties: 4,
        additionalProperties: false,
        description,
        example: {
            memory_heap: {
                status: 'up',
            },
            memory_rss: {
                status: 'up',
            },
        },
    };
}

/**
 * Generates the Swagger schema definition for the 'error' block under unhealthy responses.
 * Contains indicator errors for down components to pinpoint the source of failure.
 *
 * @param description The detailed description to be attached to the schema block
 * @returns A Swagger schema definition object outlining potential errors
 */
function createUnhealthyErrorSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            memory_heap: createErrorIndicator(
                'Heap memory usage indicator status.',
                'Heap memory usage exceeded the limit.',
            ),
            memory_rss: createErrorIndicator(
                'Resident set size memory usage indicator status.',
                'RSS memory usage exceeded the limit.',
            ),
            database: createErrorIndicator('Database connection indicator status.', 'Database connection failed.'),
            cache: createErrorIndicator('Cache connection indicator status.', 'Cache connection failed.'),
        },
        additionalProperties: false,
        description,
        example: {
            database: {
                status: 'down',
                message: 'Database connection failed.',
            },
            cache: {
                status: 'down',
                message: 'Cache connection failed.',
            },
        },
    };
}

/**
 * Generates schema metadata for a failed health indicator.
 * Standardizes how individual component failures are documented in Swagger.
 *
 * @param description The detailed description of the failing indicator
 * @param exampleMessage A sample error message illustrating the potential failure reason
 * @returns A Swagger schema definition documenting a single down indicator
 */
function createErrorIndicator(description: string, exampleMessage: string): Record<string, unknown> {
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
        description,
        example: { status: 'down', message: exampleMessage },
    };
}

/**
 * Generates the Swagger schema definition for the 'details' block under unhealthy responses.
 * Integrates status and error descriptions for all registered indicators.
 *
 * @param description The detailed description of the unified details block
 * @returns A Swagger schema definition object containing all component statuses
 */
function createUnhealthyDetailsSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        required: ['memory_heap', 'memory_rss', 'database', 'cache'],
        properties: {
            memory_heap: createDetailIndicator(
                'Heap memory usage indicator status.',
                'up',
                'Heap memory usage exceeded the limit.',
            ),
            memory_rss: createDetailIndicator(
                'Resident set size memory usage indicator status.',
                'up',
                'RSS memory usage exceeded the limit.',
            ),
            database: createDetailIndicator(
                'Database connection indicator status.',
                'down',
                'Database connection failed.',
            ),
            cache: createDetailIndicator('Cache connection indicator status.', 'down', 'Cache connection failed.'),
        },
        additionalProperties: false,
        minProperties: 4,
        maxProperties: 4,
        description,
        example: {
            memory_heap: { status: 'up' },
            memory_rss: { status: 'up' },
            database: {
                status: 'down',
                message: 'Database connection failed.',
            },
            cache: {
                status: 'down',
                message: 'Cache connection failed.',
            },
        },
    };
}

/**
 * Generates schema metadata for a detail indicator block.
 * Ensures uniformity when displaying both healthy and unhealthy states in the details object.
 *
 * @param description The detailed description of the indicator
 * @param exampleStatus The status string representing health ('up' or 'down')
 * @param exampleMessage A descriptive message shown when the indicator is down or up
 * @returns A Swagger schema definition representing the unified indicator detail
 */
function createDetailIndicator(
    description: string,
    exampleStatus: string,
    exampleMessage: string,
): Record<string, unknown> {
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
        description,
        example: { status: exampleStatus, message: exampleMessage },
    };
}
