/**
 * @file param-id.dto.ts
 * @description DTO validating the `:id` path parameter as a UUID v7 before it reaches the controller.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEntityId } from 'src/core/http/validation/decorator/entity-id.decorator';

/**
 * Reusable schema for routes addressing a single resource by its identifier,
 * so each controller does not redeclare the same parameter validation.
 */
@ApiSchema({ name: 'ParamId', description: 'Path parameter containing a unique UUID v7' })
@Exclude()
export class ParamIdDto {
    /**
     * The unique UUID v7 identifier of the resource.
     */
    @Expose()
    @IsEntityId()
    readonly id!: string;
}
