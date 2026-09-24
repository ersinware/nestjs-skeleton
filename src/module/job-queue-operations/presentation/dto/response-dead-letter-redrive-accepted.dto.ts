/**
 * @file response-dead-letter-redrive-accepted.dto.ts
 * @description Public acknowledgement of an accepted redrive request.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { isUUID } from 'src/core/http';

/**
 * Accepted operation identifier.
 */
@Exclude()
@ApiSchema({ name: 'ResponseDeadLetterRedriveAccepted', description: 'An accepted dead-letter redrive operation.' })
export class ResponseDeadLetterRedriveAcceptedDto {
    /**
     * Identifier used to query the operation's status.
     */
    @Expose()
    @isUUID('The operation ID', { version: 'all' })
    readonly operationId!: string;
}
