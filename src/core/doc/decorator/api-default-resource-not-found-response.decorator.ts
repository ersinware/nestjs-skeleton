/**
 * @file api-default-resource-not-found-response.decorator.ts
 * @description Swagger decorator standardizing the 404 Not Found response.
 */

import { ApiNotFoundResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { ResourceNotFoundMessage } from 'src/shared/exception';

/**
 * Documents the 404 Not Found response with the standard ErrorDefaultDto body.
 *
 * @param message The client-safe not-found message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultResourceNotFoundResponse(
    message: string = ResourceNotFoundMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiNotFoundResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
