/**
 * @file post-dead-letter-discard.dto.ts
 * @description Validates an exact set of pg-boss dead-letter job identifiers for discard.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * A non-empty, duplicate-free set of dead-letter jobs to discard atomically.
 */
@Exclude()
@ApiSchema({ name: 'PostDeadLetterDiscard', description: 'Exact dead-letter job identifiers to discard.' })
export class PostDeadLetterDiscardDto {
    /**
     * Pg-boss job UUIDs, which are not necessarily application UUID v7 identifiers.
     */
    @Expose()
    @IsArray({ message: 'The job IDs must be an array.' })
    @ArrayMinSize(1, { message: 'The job IDs must contain at least one job.' })
    @ArrayUnique({ message: 'The job IDs cannot contain duplicates.' })
    @IsUUID('all', { each: true, message: 'Each job ID must be a valid UUID.' })
    @ApiProperty({
        type: String,
        isArray: true,
        minItems: 1,
        uniqueItems: true,
        format: 'uuid',
        description: 'Exact shared dead-letter job identifiers.',
        example: ['b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f'],
    })
    readonly jobIds!: readonly string[];
}
