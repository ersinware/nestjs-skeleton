/**
 * @file api-default-service-unavailable-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 503 Service Unavailable response.
 */

import { ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { ResponseUnhealthyDto } from 'src/api/health/dto/response-unhealthy.dto';
import { ServiceUnavailableType } from 'src/common/exception/enum/service-unavailable-type.enum';

/**
 * Custom Swagger decorator to standardize the 503 Service Unavailable response.
 * Uses the default ResponseUnhealthyDto and standard error message.
 *
 * @param type The service unavailable failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultServiceUnavailableResponse(
    type: ServiceUnavailableType = ServiceUnavailableType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiServiceUnavailableResponse({
        description: type,
        type: ResponseUnhealthyDto,
    });
}
