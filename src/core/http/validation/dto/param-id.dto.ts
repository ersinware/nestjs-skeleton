/**
 * @file param-id.dto.ts
 * @description Data Transfer Object used for validating path parameters that contain a unique numeric ID.
 * Ensures the ID parameter conforms to a valid 32-bit positive integer range before reaching the controller.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEntityId } from 'src/core/http/validation/decorator/entity-id.decorator';

/**
 * Path parameter validation schema containing a unique resource identifier.
 */
@ApiSchema({ name: 'ParamId', description: 'Path parameter containing a unique UUID v7' })
export class ParamIdDto {
    /**
     * The unique UUID v7 identifier of the resource.
     */
    @IsEntityId('Unique identifier')
    readonly id!: string;
}
