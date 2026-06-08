/**
 * @file healthy.dto.ts
 * @description Data transfer object defining the structure of a successful system health check response.
 * Used by Swagger/Scalar to document the shape of HTTP 200 health responses.
 */

import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Equals, IsObject, IsString } from 'class-validator';
import { createHealthyIndicator } from './util/dto.util';

/**
 * Data transfer object representing a healthy application status response.
 */
@ApiSchema({
    name: 'Healthy',
    description: 'Successful health check response status',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class HealthyDto {
    /**
     * The overall status indicating the app is healthy.
     */
    @IsString()
    @Equals('ok', { message: 'Status must be exactly "ok".' })
    @ApiProperty({
        type: 'string',
        enum: ['ok'],
        description: 'The overall health status indicating success.',
        example: 'ok',
    })
    readonly status!: string;

    /**
     * Contains detailed information about healthy indicator components (memory, database, Cache).
     */
    @IsObject({ message: 'Info must be an object.' })
    @ApiProperty(createHealthDetailsSchema('Information about healthy indicators.'))
    readonly info!: Record<string, unknown>;

    /**
     * An empty error object indicating no errors occurred.
     */
    @IsObject({ message: 'Error must be an object.' })
    @ApiProperty({
        type: 'object',
        additionalProperties: false,
        description: 'No errors present for a healthy status.',
        example: {},
    })
    readonly error!: Record<string, never>;

    /**
     * Combined map of all indicators and their healthy status.
     */
    @IsObject({ message: 'Details must be an object.' })
    @ApiProperty(createHealthDetailsSchema('Combined details of healthy indicators.'))
    readonly details!: Record<string, unknown>;
}

/**
 * Creates Swagger schema definition metadata for healthy system components (heap, RSS, database, Cache).
 *
 * @param description Description of the detail schema object.
 * @returns Swagger-compliant property details schema.
 */
function createHealthDetailsSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        required: ['memory_heap', 'memory_rss', 'database', 'cache'],
        properties: {
            memory_heap: createHealthyIndicator('Heap memory usage indicator status.'),
            memory_rss: createHealthyIndicator('Resident set size memory usage indicator status.'),
            database: createHealthyIndicator('Database connection indicator status.'),
            cache: createHealthyIndicator('Cache connection indicator status.'),
        },
        additionalProperties: false,
        minProperties: 4,
        maxProperties: 4,
        description,
        example: {
            memory_heap: { status: 'up' },
            memory_rss: { status: 'up' },
            database: { status: 'up' },
            cache: { status: 'up' },
        },
    };
}
