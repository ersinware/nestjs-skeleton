/**
 * @file api-default-invalid-request-response.decorator.ts
 * @description Swagger decorator standardizing the 400 Bad Request response.
 */

import { ApiBadRequestResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { InvalidInputMessage } from 'src/shared/exception';

/**
 * Documents the 400 Bad Request response with the standard ErrorDefaultDto body.
 *
 * @param message The client-safe invalid-request message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultInvalidRequestResponse(
    message: string = InvalidInputMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiBadRequestResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
