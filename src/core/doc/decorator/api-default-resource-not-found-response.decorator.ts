/**
 * @file api-default-resource-not-found-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 404 Not Found response.
 */

import { ApiNotFoundResponse } from '@nestjs/swagger';
import { ErrorDefaultDto, ResourceNotFoundType } from 'src/core/exception';

/**
 * Custom Swagger decorator to standardize the 404 Not Found response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The not found failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultResourceNotFoundResponse(
    type: ResourceNotFoundType = ResourceNotFoundType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiNotFoundResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
