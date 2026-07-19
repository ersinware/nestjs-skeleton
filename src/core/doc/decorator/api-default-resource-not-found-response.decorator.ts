/**
 * @file api-default-resource-not-found-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 404 Not Found response.
 */

import { ApiNotFoundResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { ResourceNotFoundMessage } from 'src/shared/exception';

/**
 * Custom Swagger decorator to standardize the 404 Not Found response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param message The client-safe not-found message — typed as a plain string because module-owned
 * vocabularies (e.g. a use case's rejection messages) must be documentable without core knowing them.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultResourceNotFoundResponse(
    message: string = ResourceNotFoundMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiNotFoundResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
