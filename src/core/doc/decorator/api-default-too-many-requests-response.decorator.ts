/**
 * @file api-default-too-many-requests-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 429 Too Many Requests response.
 */

import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ErrorDefaultDto, TooManyRequestsType } from 'src/core/exception';

/**
 * Custom Swagger decorator to standardize the 429 Too Many Requests response.
 * Uses the default ErrorDefaultDto and standard error messages based on target type.
 *
 * @param type The type of validation target.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultTooManyRequestsResponse(
    type: TooManyRequestsType = TooManyRequestsType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiTooManyRequestsResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
