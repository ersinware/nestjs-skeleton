/**
 * @file api-default-too-many-requests-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 429 Too Many Requests response.
 */

import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { RateLimitMessage } from 'src/core/security/throttle';

/**
 * Custom Swagger decorator to standardize the 429 Too Many Requests response.
 * Uses the default ErrorDefaultDto and standard error messages based on target type.
 *
 * @param message The client-safe rate-limit message.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultTooManyRequestsResponse(
    message: RateLimitMessage = RateLimitMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiTooManyRequestsResponse({
        description: message,
        type: ErrorDefaultDto,
    });
}
