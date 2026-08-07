/**
 * @file api-default-dependency-unavailable-response.decorator.ts
 * @description Swagger decorator standardizing the 503 Service Unavailable response.
 */

import { ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { DependencyUnavailableMessage } from 'src/shared/exception';

/**
 * Documents the 503 Service Unavailable response with the standard ErrorDefaultDto body — the shape
 * the global filter renders when a backing dependency is unreachable. Not for the health probes,
 * whose deliberate body-less 503 bypasses that normalization.
 *
 * @param message The client-safe unavailability message — a plain string so module-owned
 * vocabularies stay documentable without core knowing them.
 * @returns A decorator applying the response metadata to a controller or method.
 */
export function ApiDefaultDependencyUnavailableResponse(
    message: string = DependencyUnavailableMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiServiceUnavailableResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
