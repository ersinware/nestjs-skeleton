/**
 * @file response-dead-letter-redrive-status.dto.ts
 * @description Public lifecycle view of a retained redrive operation.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { isUUID } from 'src/core/http';
import type { DeadLetterRedriveStatus } from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive-status/query';

/**
 * Sanitized redrive status without job payloads or speculative progress counts.
 */
@Exclude()
@ApiSchema({ name: 'ResponseDeadLetterRedriveStatus', description: 'Status of a retained dead-letter redrive.' })
export class ResponseDeadLetterRedriveStatusDto {
    /**
     * Identifier returned when the operation was accepted.
     */
    @Expose()
    @isUUID('The operation ID', { version: 'all' })
    readonly operationId!: string;

    /**
     * Current pg-boss orchestration lifecycle state.
     */
    @Expose()
    @ApiProperty({
        enum: ['ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] satisfies DeadLetterRedriveStatus[],
        example: 'RUNNING' satisfies DeadLetterRedriveStatus,
    })
    readonly status!: DeadLetterRedriveStatus;

    /**
     * Time the operation was enqueued.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'date-time', example: '2026-09-21T12:00:00.000Z' })
    readonly createdOn!: Date;

    /**
     * Terminal completion time, or null while queued or running.
     */
    @Expose()
    @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: '2026-09-21T12:01:00.000Z' })
    readonly completedOn!: Date | null;
}
