/**
 * @file param-dead-letter-redrive-operation-id.dto.ts
 * @description Validates a pg-boss redrive operation identifier in the route.
 */

import { ApiSchema } from '@nestjs/swagger';
import { isUUID } from 'src/core/http';

/**
 * Path parameters identifying one retained redrive operation.
 */
@ApiSchema({ name: 'ParamDeadLetterRedriveOperationId', description: 'A redrive operation identifier.' })
export class ParamDeadLetterRedriveOperationIdDto {
    /**
     * The caller-visible pg-boss orchestration job UUID.
     */
    @isUUID('The operation ID', { version: 'all' })
    readonly operationId!: string;
}
