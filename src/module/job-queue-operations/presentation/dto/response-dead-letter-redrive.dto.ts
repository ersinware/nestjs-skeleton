/**
 * @file response-dead-letter-redrive.dto.ts
 * @description Public lifecycle view of one retained redrive.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { isUUID } from 'src/core/http';
import type { DeadLetterRedriveStatus } from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/query';

/**
 * Sanitized redrive summary without internal payloads or speculative progress counts.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseDeadLetterRedrive',
    description: 'Retained dead-letter redrive summary.',
})
export class ResponseDeadLetterRedriveDto {
    /**
     * Identifier of the retained redrive operation.
     */
    @Expose()
    @isUUID('The operation ID', { version: 'all' })
    readonly id!: string;

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
