/**
 * @file param-dead-letter-job-id.dto.ts
 * @description Validates pg-boss-generated UUID job identifiers in the route.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * Path parameters identifying one pg-boss dead-letter job.
 */
@Exclude()
@ApiSchema({ name: 'ParamDeadLetterJobId', description: 'A dead-letter job identifier.' })
export class ParamDeadLetterJobIdDto {
    /**
     * The pg-boss job UUID, which may not be an application UUID v7.
     */
    @Expose()
    @IsNotEmpty({ message: `The job ID cannot be empty.` })
    @IsUUID('all', { message: 'The job ID must be a valid UUID.' })
    @ApiProperty({
        type: 'string',
        format: 'uuid',
        description: 'The pg-boss dead-letter job identifier.',
        example: 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f',
    })
    readonly id!: string;
}
