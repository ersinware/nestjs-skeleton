/**
 * @file api-default-unauthenticated-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 401 Unauthorized response.
 */

import { ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorDefaultDto, UnauthenticatedType } from 'src/core/exception';

/**
 * Custom Swagger decorator to standardize the 401 Unauthorized response.
 * Uses the default ErrorDefaultDto and standard error messages based on authorization failure type.
 *
 * @param type The type of authorization failure.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultUnauthenticatedResponse(
    type: UnauthenticatedType = UnauthenticatedType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiUnauthorizedResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
