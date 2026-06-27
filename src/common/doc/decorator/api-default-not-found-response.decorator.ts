/**
 * @file api-default-not-found-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 404 Not Found response.
 */

import { ApiNotFoundResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/common/exception/dto/error-default.dto';
import { NotFoundType } from 'src/common/exception/enum/not-found-type.enum';

/**
 * Custom Swagger decorator to standardize the 404 Not Found response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The not found failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultNotFoundResponse(
    type: NotFoundType = NotFoundType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiNotFoundResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
