/**
 * @file response-healthy.dto.ts
 * @description Defines the exact data structure returned when the system passes all health checks. It provides strict typing and Swagger documentation for HTTP 200 health responses, ensuring consumers understand the expected payload format.
 */

import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { Equals, IsObject, IsString } from 'class-validator';
import { createHealthyIndicator } from 'src/module/health/presentation/dto/util/dto.util';

/**
 * Data transfer object representing a healthy application status response.
 * Used to explicitly map out the response body of a successful health check.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseHealthy',
    description: 'Successful health check response status',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class ResponseHealthyDto {
    /**
     * The overall status indicating the app is healthy.
     * Always set to "ok" to allow quick string matching by external health monitors.
     */
    @Expose()
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
     * Useful for diagnosing which components are currently active and performing well.
     */
    @Expose()
    @IsObject({ message: 'Info must be an object.' })
    @ApiProperty(createHealthDetailsSchema('Information about healthy indicators.'))
    readonly info!: Record<string, unknown>;

    /**
     * An empty error object indicating no errors occurred.
     * Required by the schema to maintain a consistent shape even when everything is healthy.
     */
    @Expose()
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
     * Provides a consolidated view of all tested systems in one object.
     */
    @Expose()
    @IsObject({ message: 'Details must be an object.' })
    @ApiProperty(createHealthDetailsSchema('Combined details of healthy indicators.'))
    readonly details!: Record<string, unknown>;
}

/**
 * Creates Swagger schema definition metadata for healthy system components (heap, RSS, database, Cache).
 * Abstracts the verbose schema generation logic to keep the DTO class clean and readable.
 *
 * @param description The detailed description to be attached to the schema object
 * @returns A Swagger-compliant property details schema configuration
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
