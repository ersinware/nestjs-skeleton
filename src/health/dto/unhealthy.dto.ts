/**
 * @file unhealthy.dto.ts
 * @description Data transfer object defining the structure of an unhealthy/failed health check response.
 * Used by Swagger/Scalar to document HTTP 503 Service Unavailable health check responses.
 */

import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Equals, IsObject, IsString } from 'class-validator';
import { createHealthyIndicator } from './util/dto.util';

/**
 * Data transfer object representing an unhealthy application status response.
 */
@ApiSchema({
    name: 'Unhealthy',
    description: 'Unhealthy health check response status',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class UnhealthyDto {
    /**
     * The overall status indicating the app is unhealthy.
     */
    @IsString()
    @Equals('error', { message: 'Status must be exactly "error".' })
    @ApiProperty({
        type: 'string',
        description: 'The overall health status indicating failure.',
        example: 'error',
        enum: ['error'],
    })
    readonly status!: string;

    /**
     * Contains detailed information about indicators that are currently healthy.
     */
    @IsObject({ message: 'Info must be an object.' })
    @ApiProperty(createUnhealthyInfoSchema('Information about healthy indicators.'))
    readonly info!: Record<string, unknown>;

    /**
     * Contains detailed failure information about indicators that are currently down.
     */
    @IsObject({ message: 'Error must be an object.' })
    @ApiProperty(createUnhealthyErrorSchema('Information about indicators that failed.'))
    readonly error!: Record<string, unknown>;

    /**
     * Combined map of all indicators containing their current status and error messages if down.
     */
    @IsObject({ message: 'Details must be an object.' })
    @ApiProperty(createUnhealthyDetailsSchema('Combined details of all health indicators.'))
    readonly details!: Record<string, unknown>;
}

/**
 * Generates the Swagger schema definition for the 'info' block under unhealthy responses.
 * Contains only properties that are currently healthy.
 *
 * @param description Detailed description of the schema block.
 * @returns Swagger schema definition object.
 */
function createUnhealthyInfoSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        description,
        properties: {
            memory_heap: createHealthyIndicator('Heap memory usage indicator status.'),
            memory_rss: createHealthyIndicator('Resident set size memory usage indicator status.'),
            database: createHealthyIndicator('Database connection indicator status.'),
            cache: createHealthyIndicator('Cache connection indicator status.'),
        },
        minProperties: 0,
        maxProperties: 4,
        additionalProperties: false,
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
 * Contains indicator errors for down components.
 *
 * @param description Detailed description of the schema block.
 * @returns Swagger schema definition object.
 */
function createUnhealthyErrorSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        description,
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
 *
 * @param description Detailed description of the indicator.
 * @param exampleMessage Sample error message.
 * @returns Swagger schema definition for a down indicator.
 */
function createErrorIndicator(description: string, exampleMessage: string): Record<string, unknown> {
    return {
        description,
        type: 'object',
        required: ['status', 'message'],
        properties: {
            status: {
                type: 'string',
                description: 'Indicator status',
                example: 'down',
                enum: ['down'],
                minLength: 4,
                maxLength: 4,
            },
            message: {
                type: 'string',
                description: 'Failure message.',
                example: exampleMessage,
                minLength: 1,
            },
        },
        additionalProperties: false,
        example: { status: 'down', message: exampleMessage },
    };
}

/**
 * Generates the Swagger schema definition for the 'details' block under unhealthy responses.
 * Integrates status and error descriptions for all registered indicators.
 *
 * @param description Detailed description of the schema block.
 * @returns Swagger schema definition object.
 */
function createUnhealthyDetailsSchema(description: string): Record<string, unknown> {
    return {
        description,
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
 *
 * @param description Detailed description of the indicator.
 * @param exampleStatus The status string representing health ('up' or 'down').
 * @param exampleMessage Details message shown when the indicator is down.
 * @returns Swagger schema definition for the detail indicator.
 */
function createDetailIndicator(
    description: string,
    exampleStatus: string,
    exampleMessage: string,
): Record<string, unknown> {
    return {
        description,
        type: 'object',
        required: ['status'],
        properties: {
            status: {
                type: 'string',
                description: 'Indicator status',
                example: exampleStatus,
                enum: ['up', 'down'],
                minLength: 2,
                maxLength: 4,
            },
            message: {
                type: 'string',
                description: 'Failure message.',
                example: exampleMessage,
                minLength: 1,
            },
        },
        additionalProperties: false,
        example: { status: exampleStatus, message: exampleMessage },
    };
}
