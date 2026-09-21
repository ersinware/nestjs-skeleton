/**
 * @file param-dead-letter-redrive-operation-id.dto.ts
 * @description Validates a pg-boss redrive operation identifier in the route.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsUuidId } from 'src/core/http';

/**
 * Path parameters identifying one retained redrive operation.
 */
@Exclude()
@ApiSchema({ name: 'ParamDeadLetterRedriveOperationId', description: 'A redrive operation identifier.' })
export class ParamDeadLetterRedriveOperationIdDto {
    /**
     * The caller-visible pg-boss orchestration job UUID.
     */
    @Expose()
    @IsUuidId('The operation ID', { version: 'all' })
    readonly operationId!: string;
}
