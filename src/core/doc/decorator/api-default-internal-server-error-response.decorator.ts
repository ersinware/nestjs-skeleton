/**
 * @file api-default-internal-server-error-response.decorator.ts
 * @description Swagger decorator standardizing the 500 Internal Server Error response.
 */

import { ApiInternalServerErrorResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { SystemMessage } from 'src/shared/exception';

/**
 * Documents the 500 Internal Server Error response with the standard ErrorDefaultDto body.
 *
 * @param message The client-safe internal-error message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultInternalServerErrorResponse(
    message: string = SystemMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiInternalServerErrorResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
