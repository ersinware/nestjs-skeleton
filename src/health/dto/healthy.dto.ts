import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Equals, IsObject, IsString } from 'class-validator';
import { createHealthyIndicator } from '../util/dto.util';

@ApiSchema({
    name: 'Healthy',
    description: 'Successful health check response status',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class HealthyDto {
    @ApiProperty({
        type: 'string',
        description: 'The overall health status indicating success.',
        example: 'ok',
        enum: ['ok'],
    })
    @IsString()
    @Equals('ok', { message: 'Status must be exactly "ok".' })
    readonly status!: string;

    @ApiProperty(createHealthDetailsSchema('Information about healthy indicators.'))
    @IsObject({ message: 'Info must be an object.' })
    readonly info!: Record<string, unknown>;

    @ApiProperty({
        description: 'No errors present for a healthy status.',
        type: 'object',
        additionalProperties: false,
        example: {},
    })
    @IsObject({ message: 'Error must be an object.' })
    readonly error!: Record<string, never>;

    @ApiProperty(createHealthDetailsSchema('Combined details of healthy indicators.'))
    @IsObject({ message: 'Details must be an object.' })
    readonly details!: Record<string, unknown>;
}

function createHealthDetailsSchema(description: string): Record<string, unknown> {
    return {
        description,
        type: 'object',
        required: ['memory_heap', 'memory_rss', 'database'],
        properties: {
            memory_heap: createHealthyIndicator('Heap memory usage indicator status.'),
            memory_rss: createHealthyIndicator('Resident set size memory usage indicator status.'),
            database: createHealthyIndicator('Database connection indicator status.'),
        },
        additionalProperties: false,
        minProperties: 3,
        maxProperties: 3,
        example: { memory_heap: { status: 'up' }, memory_rss: { status: 'up' }, database: { status: 'up' } },
    };
}
