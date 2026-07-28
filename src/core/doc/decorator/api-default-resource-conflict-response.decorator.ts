/**
 * @file api-default-resource-conflict-response.decorator.ts
 * @description Swagger decorator standardizing the 409 Conflict response.
 */

import { ApiConflictResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * Documents the 409 Conflict response with the standard ErrorDefaultDto body.
 *
 * @param message The client-safe conflict message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultResourceConflictResponse(
    message: string = ResourceConflictMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiConflictResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
