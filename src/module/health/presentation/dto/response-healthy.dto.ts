/**
 * @file response-healthy.dto.ts
 * @description Response body of a fully passed health check (HTTP 200).
 */

import { ApiExtension, ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
    HEALTH_INDICATOR_KEYS,
    HealthIndicatorKey,
    HealthyIndicatorState,
} from 'src/module/health/application/query/get-health-status/query';
import { createHealthyIndicatorProperties } from 'src/module/health/presentation/dto/health-indicator-schema.util';

/**
 * Response body of a fully passed health check, mirroring the Terminus report shape.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseHealthy',
    description: 'Report returned when every health indicator passes.',
})
@ApiExtension('x-force-required', ['status', 'info', 'error', 'details'])
export class ResponseHealthyDto {
    /**
     * Overall status; always "ok" on this response.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        enum: ['ok'],
        description: 'Overall status; always "ok".',
        example: 'ok',
    })
    readonly status!: 'ok';

    /**
     * Per-indicator state of the healthy components — all of them on this response.
     */
    @Expose()
    @ApiProperty(createHealthyDetailsSchema('States of the healthy indicators.'))
    readonly info!: Record<HealthIndicatorKey, unknown>;

    /**
     * Always empty here; present so both health responses share one shape.
     */
    @Expose()
    @ApiProperty({
        type: 'object',
        additionalProperties: false,
        description: 'Always empty on a healthy response.',
        example: {} satisfies Record<string, never>,
    })
    readonly error!: Record<string, never>;

    /**
     * Combined per-indicator state; identical to `info` on a healthy response.
     */
    @Expose()
    @ApiProperty(createHealthyDetailsSchema('Combined states of all indicators.'))
    readonly details!: Record<HealthIndicatorKey, unknown>;
}

/**
 * Builds the schema of a block holding every indicator in its healthy state.
 *
 * @param description The block's description
 * @returns The block schema
 */
function createHealthyDetailsSchema(description: string): Record<string, unknown> {
    return {
        type: 'object',
        required: [...HEALTH_INDICATOR_KEYS],
        properties: createHealthyIndicatorProperties(),
        additionalProperties: false,
        minProperties: HEALTH_INDICATOR_KEYS.length,
        maxProperties: HEALTH_INDICATOR_KEYS.length,
        description,
        example: {
            memory_heap: { status: 'up' },
            memory_rss: { status: 'up' },
            database: { status: 'up' },
            cache: { status: 'up' },
            session: { status: 'up' },
        } satisfies Record<HealthIndicatorKey, HealthyIndicatorState>,
    };
}
