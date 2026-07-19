/**
 * @file api-default-unauthenticated-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 401 Unauthorized response.
 */

import { ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Custom Swagger decorator to standardize the 401 Unauthorized response.
 * Uses the default ErrorDefaultDto and standard error messages based on authorization failure type.
 *
 * @param message The client-safe unauthenticated message — typed as a plain string because module-owned
 * vocabularies (e.g. a use case's rejection messages) must be documentable without core knowing them.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultUnauthenticatedResponse(
    message: string = UnauthenticatedMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiUnauthorizedResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
