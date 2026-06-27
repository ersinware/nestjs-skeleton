/**
 * @file api-default-bad-request-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 400 Bad Request response.
 */

import { ApiBadRequestResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/common/exception/dto/error-default.dto';
import { BadRequestType } from 'src/common/exception/enum/bad-request-type.enum';

/**
 * Custom Swagger decorator to standardize the 400 Bad Request response.
 * Uses the default ErrorDefaultDto and standard error messages based on target type.
 *
 * @param type The type of validation target.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultBadRequestResponse(
    type: BadRequestType = BadRequestType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiBadRequestResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
