/**
 * @file post-dead-letter-failed-redrives-discard.dto.ts
 * @description Validates an exact set of retained failed redrive identifiers for discard.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Bounds synchronous deletion and audit payload size per redrive discard request.
 */
const MAX_DISCARD_REDRIVES = 100;

/**
 * A non-empty, duplicate-free set of failed dead-letter redrives to discard atomically.
 */
@ApiSchema({
    name: 'PostDeadLetterFailedRedrivesDiscard',
    description: 'Failed dead-letter redrives to discard.',
})
export class PostDeadLetterFailedRedrivesDiscardDto {
    /**
     * Pg-boss orchestration job UUIDs returned by the redrive listing.
     */
    @IsArray({ message: 'The IDs must be an array.' })
    @ArrayMinSize(1, { message: 'The IDs must contain at least one redrive.' })
    @ArrayMaxSize(MAX_DISCARD_REDRIVES, {
        message: `The IDs must contain at most ${MAX_DISCARD_REDRIVES} redrives.`,
    })
    @ArrayUnique({ message: 'The IDs cannot contain duplicates.' })
    @IsUUID('all', { each: true, message: 'Each ID must be a valid UUID.' })
    @ApiProperty({
        type: String,
        isArray: true,
        minItems: 1,
        maxItems: MAX_DISCARD_REDRIVES,
        uniqueItems: true,
        format: 'uuid',
        description: 'Failed dead-letter redrive identifiers.',
        example: ['b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f'],
    })
    readonly ids!: readonly string[];
}
