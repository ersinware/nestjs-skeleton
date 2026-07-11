/**
 * @file api-default-invalid-request-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 400 Bad Request response.
 */

import { ApiBadRequestResponse } from '@nestjs/swagger';
import { ErrorDefaultDto, InvalidRequestType } from 'src/core/exception';

/**
 * Custom Swagger decorator to standardize the 400 Bad Request response.
 * Uses the default ErrorDefaultDto and standard error messages based on target type.
 *
 * @param type The type of validation target.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultInvalidRequestResponse(
    type: InvalidRequestType = InvalidRequestType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiBadRequestResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
