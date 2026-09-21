/**
 * @file response-dead-letter-redrive-accepted.dto.ts
 * @description Public acknowledgement of an accepted redrive request.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsUuidId } from 'src/core/http';

/**
 * Accepted operation identifier and initial lifecycle state.
 */
@Exclude()
@ApiSchema({ name: 'ResponseDeadLetterRedriveAccepted', description: 'An accepted dead-letter redrive operation.' })
export class ResponseDeadLetterRedriveAcceptedDto {
    /**
     * Identifier used to query the operation's status.
     */
    @Expose()
    @IsUuidId('The operation ID', { version: 'all' })
    readonly operationId!: string;

    /**
     * Initial status of an accepted operation.
     */
    @Expose()
    @ApiProperty({ enum: ['ACCEPTED'], example: 'ACCEPTED' })
    readonly status!: 'ACCEPTED';
}
