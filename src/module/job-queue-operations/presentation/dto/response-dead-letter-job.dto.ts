/**
 * @file response-dead-letter-job.dto.ts
 * @description Allowlisted metadata returned for dead-letter jobs.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * Public dead-letter metadata without payloads or error output.
 */
@Exclude()
@ApiSchema({ name: 'ResponseDeadLetterJob', description: 'Sanitized metadata of one dead-letter job.' })
export class ResponseDeadLetterJobDto {
    /**
     * Dead-letter copy identifier.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'uuid', example: 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f' })
    readonly id!: string;

    /**
     * Time the dead-letter copy was created.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'date-time', example: '2026-09-21T12:00:00.000Z' })
    readonly createdOn!: Date;

    /**
     * Original queue name.
     */
    @Expose()
    @ApiProperty({ type: 'string', example: 'admin-invite' })
    readonly sourceName!: string;

    /**
     * Original job identifier.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'uuid', example: '6fd94df7-f858-458d-ae75-e79fcdb37987' })
    readonly sourceId!: string;

    /**
     * Original job creation time.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'date-time', example: '2026-09-20T12:00:00.000Z' })
    readonly sourceCreatedOn!: Date;

    /**
     * Original job retry count.
     */
    @Expose()
    @ApiProperty({ type: 'integer', minimum: 0, example: 10 })
    readonly sourceRetryCount!: number;

    /**
     * Stable logical delivery identifier.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'uuid', example: 'd0b1fdba-d2cc-4212-8caa-50ac662ab114' })
    readonly deliveryId!: string;

    /**
     * Aggregate identifier carried by the original job.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'uuid', example: '018f43c3-6bb3-7d72-911e-848821a837c3' })
    readonly aggregateId!: string;
}
