/**
 * @file api-default-unauthenticated-response.decorator.ts
 * @description Swagger decorator standardizing the 401 Unauthorized response.
 */

import { ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Documents the 401 Unauthorized response with the standard ErrorDefaultDto body.
 *
 * @param message The client-safe unauthenticated message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultUnauthenticatedResponse(
    message: string = UnauthenticatedMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiUnauthorizedResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
