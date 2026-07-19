/**
 * @file api-default-internal-server-error-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 500 Internal Server Error response.
 */

import { ApiInternalServerErrorResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { SystemMessage } from 'src/shared/exception';

/**
 * Custom Swagger decorator to standardize the 500 Internal Server Error response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The internal server error failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultInternalServerErrorResponse(
    type: SystemMessage = SystemMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiInternalServerErrorResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
