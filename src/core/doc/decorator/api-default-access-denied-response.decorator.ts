/**
 * @file api-default-access-denied-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 403 Forbidden response.
 */

import { ApiForbiddenResponse } from '@nestjs/swagger';
import { AccessDeniedType, ErrorDefaultDto } from 'src/core/exception';

/**
 * Custom Swagger decorator to standardize the 403 Forbidden response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The forbidden failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultAccessDeniedResponse(
    type: AccessDeniedType = AccessDeniedType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiForbiddenResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
