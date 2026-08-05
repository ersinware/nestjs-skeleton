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

/**
 * The route-parameter name this DTO binds — the one place the `:id` literal lives, so a consumer
 * reading the parameter by name (e.g. the audit interceptor) cannot drift from the DTO. The
 * `satisfies` clause ties it to the class: renaming the property without this fails compilation.
 */
export const PARAM_ID = 'id' satisfies keyof ParamIdDto;

/**
 * The route-template fragment binding {@link PARAM_ID} (`:id`), so controllers declaring a route
 * this DTO validates — `@Get(ROUTE_PARAM_ID)`, or a template like `ROUTE_PARAM_ID + '/ban'` —
 * derive it from the same single source instead of restating the literal.
 */
export const ROUTE_PARAM_ID = `:${PARAM_ID}`;
