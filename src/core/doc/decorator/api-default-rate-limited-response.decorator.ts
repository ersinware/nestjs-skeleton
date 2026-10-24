/**
 * @file api-default-rate-limited-response.decorator.ts
 * @description Swagger contract for admission refusals and the standard retry delay header.
 */

import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/core/exception';
import { RateLimitedMessage } from 'src/shared/exception';

/**
 * Documents a standard error body without exposing policy names or request trackers.
 *
 * @param message Client-safe admission refusal description.
 * @returns The controller or method response decorator.
 */
export function ApiDefaultRateLimitedResponse(
    message: string = RateLimitedMessage.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiTooManyRequestsResponse({
        description: message,
        type: ErrorDefaultDto,
        headers: {
            'Retry-After': {
                required: true,
                description:
                    'Whole seconds remaining on the first blocking counter; admission after waiting is not guaranteed.',
                schema: { type: 'integer', minimum: 1, example: 10 },
            },
        },
    });
}
