/**
 * @file api-default-access-denied-response.decorator.ts
 * @description Swagger decorator standardizing the 403 Forbidden response.
 */

import { ApiForbiddenResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { AccessDeniedMessage } from 'src/shared/exception';

/**
 * Documents the 403 Forbidden response with the standard ErrorDefaultDto body.
 *
 * @param message The client-safe access-denied message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultAccessDeniedResponse(
    message: string = AccessDeniedMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiForbiddenResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
