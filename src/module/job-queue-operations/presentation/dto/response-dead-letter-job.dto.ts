/**
 * @file response-dead-letter-job.dto.ts
 * @description Allowlisted metadata returned for dead-letter jobs.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsUuidId } from 'src/core/http';

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
    @IsUuidId('The dead-letter job ID', { version: 'all' })
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
    @IsUuidId('The source job ID', { version: 'all' })
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
    @IsUuidId('The delivery ID', { version: 'all' })
    readonly deliveryId!: string;

    /**
     * Aggregate identifier carried by the original job.
     */
    @Expose()
    @IsUuidId('The aggregate ID')
    readonly aggregateId!: string;
}
