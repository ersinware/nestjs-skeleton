import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Equals, IsObject, IsString } from 'class-validator';
import { createHealthyIndicator } from '../util/dto.util';

@ApiSchema({
    name: 'Unhealthy',
    description: 'Unhealthy health check response status',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class UnhealthyDto {
    @ApiProperty({
        type: 'string',
        description: 'The overall health status indicating failure.',
        example: 'error',
        enum: ['error'],
    })
    @IsString()
    @Equals('error', { message: 'Status must be exactly "error".' })
    readonly status!: string;

    @ApiProperty(createUnhealthyInfoSchema('Information about healthy indicators.'))
    @IsObject({ message: 'Info must be an object.' })
    readonly info!: Record<string, unknown>;

    @ApiProperty(createUnhealthyErrorSchema('Information about indicators that failed.'))
    @IsObject({ message: 'Error must be an object.' })
    readonly error!: Record<string, unknown>;

    @ApiProperty(createUnhealthyDetailsSchema('Combined details of all health indicators.'))
    @IsObject({ message: 'Details must be an object.' })
    readonly details!: Record<string, unknown>;
}

function createErrorIndicator(description: string, message: string): Record<string, unknown> {
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
                description: 'Failure or detail message.',
                example: message,
                minLength: 1,
            },
        },
        additionalProperties: false,
        example: { status: 'down', message },
    };
}

function createDetailIndicator(
    description: string,
    exampleStatus: string,
    exampleMessage?: string,
): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        status: {
            type: 'string',
            description: 'Indicator status',
            example: exampleStatus,
            enum: ['up', 'down'],
            minLength: 2,
            maxLength: 4,
        },
    };
    properties['message'] = {
        type: 'string',
        description: 'Failure or detail message.',
        example: exampleMessage || 'Detail message not present when up.',
        minLength: 1,
    };

    return {
        description,
        type: 'object',
        required: ['status'],
        properties,
        additionalProperties: false,
        example: exampleMessage ? { status: exampleStatus, message: exampleMessage } : { status: exampleStatus },
    };
}

function createUnhealthyInfoSchema(description: string): Record<string, unknown> {
    return {
        description,
        type: 'object',
        properties: {
            memory_heap: createHealthyIndicator('Heap memory usage indicator status.'),
            memory_rss: createHealthyIndicator('Resident set size memory usage indicator status.'),
            database: createHealthyIndicator('Database connection indicator status.'),
            redis: createHealthyIndicator('Redis connection indicator status.'),
        },
        additionalProperties: false,
        example: {
            memory_heap: { status: 'up' },
            memory_rss: { status: 'up' },
        },
    };
}

function createUnhealthyErrorSchema(description: string): Record<string, unknown> {
    return {
        description,
        type: 'object',
        properties: {
            memory_heap: createErrorIndicator(
                'Heap memory usage indicator status.',
                'Heap memory usage exceeded the limit',
            ),
            memory_rss: createErrorIndicator(
                'Resident set size memory usage indicator status.',
                'RSS memory usage exceeded the limit',
            ),
            database: createErrorIndicator(
                'Database connection indicator status.',
                'Database connection failed or unreachable',
            ),
            redis: createErrorIndicator('Redis connection indicator status.', 'Redis connection failed or unreachable'),
        },
        additionalProperties: false,
        example: {
            database: {
                status: 'down',
                message: 'Database connection failed.',
            },
            redis: {
                status: 'down',
                message: 'Redis connection failed.',
            },
        },
    };
}

function createUnhealthyDetailsSchema(description: string): Record<string, unknown> {
    return {
        description,
        type: 'object',
        required: ['memory_heap', 'memory_rss', 'database', 'redis'],
        properties: {
            memory_heap: createDetailIndicator('Heap memory usage indicator status.', 'up'),
            memory_rss: createDetailIndicator('Resident set size memory usage indicator status.', 'up'),
            database: createDetailIndicator(
                'Database connection indicator status.',
                'down',
                'Database connection failed.',
            ),
            redis: createDetailIndicator('Redis connection indicator status.', 'down', 'Redis connection failed.'),
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
            redis: {
                status: 'down',
                message: 'Redis connection failed.',
            },
        },
    };
}
