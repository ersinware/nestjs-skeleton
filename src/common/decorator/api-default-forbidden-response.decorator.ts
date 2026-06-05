/**
 * @file api-default-forbidden-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 403 Forbidden response.
 */

import { ApiForbiddenResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { ForbiddenType } from './enum/forbidden-type.enum';

export { ForbiddenType };

/**
 * Custom Swagger decorator to standardize the 403 Forbidden response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The forbidden failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultForbiddenResponse(
    type: ForbiddenType = ForbiddenType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiForbiddenResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
