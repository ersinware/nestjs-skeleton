/**
 * @file api-default-resource-conflict-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 409 Conflict response.
 */

import { ApiConflictResponse } from '@nestjs/swagger';
import { ErrorDefaultDto, ResourceConflictType } from 'src/core/exception';

/**
 * Custom Swagger decorator to standardize the 409 Conflict response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The conflict failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultResourceConflictResponse(
    type: ResourceConflictType = ResourceConflictType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiConflictResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
