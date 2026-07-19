/**
 * @file api-default-resource-conflict-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 409 Conflict response.
 */

import { ApiConflictResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { ResourceConflictMessage } from 'src/shared/exception';

/**
 * Custom Swagger decorator to standardize the 409 Conflict response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param message The client-safe conflict message — typed as a plain string because module-owned
 * vocabularies (e.g. a use case's rejection messages) must be documentable without core knowing them.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultResourceConflictResponse(
    message: string = ResourceConflictMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiConflictResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
