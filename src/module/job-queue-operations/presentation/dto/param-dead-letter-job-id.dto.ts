/**
 * @file param-dead-letter-job-id.dto.ts
 * @description Validates pg-boss-generated UUID job identifiers in the route.
 */

import { ApiSchema } from '@nestjs/swagger';
import { isUUID } from 'src/core/http';

/**
 * Path parameters identifying one pg-boss dead-letter job.
 */
@ApiSchema({ name: 'ParamDeadLetterJobId', description: 'A dead-letter job identifier.' })
export class ParamDeadLetterJobIdDto {
    /**
     * The pg-boss job UUID, which may not be an application UUID v7.
     */
    @isUUID('The job ID', { version: 'all' })
    readonly id!: string;
}
