/**
 * @file api-default-service-unavailable-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 503 Service Unavailable response.
 */

import { ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { UnhealthyDto } from 'src/health/dto/unhealthy.dto';
import { ServiceUnavailableType } from './enum/service-unavailable-type.enum';

export { ServiceUnavailableType };

/**
 * Custom Swagger decorator to standardize the 503 Service Unavailable response.
 * Uses the default UnhealthyDto and standard error message.
 *
 * @param type The service unavailable failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultServiceUnavailableResponse(
    type: ServiceUnavailableType = ServiceUnavailableType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiServiceUnavailableResponse({
        description: type,
        type: UnhealthyDto,
    });
}
