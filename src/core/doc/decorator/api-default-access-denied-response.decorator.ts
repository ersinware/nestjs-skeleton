/**
 * @file api-default-access-denied-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 403 Forbidden response.
 */

import { ApiForbiddenResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { AccessDeniedMessage } from 'src/shared/exception';

/**
 * Custom Swagger decorator to standardize the 403 Forbidden response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param message The client-safe access-denied message — typed as a plain string because module-owned
 * vocabularies (e.g. a use case's rejection messages) must be documentable without core knowing them.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultAccessDeniedResponse(
    message: string = AccessDeniedMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiForbiddenResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
