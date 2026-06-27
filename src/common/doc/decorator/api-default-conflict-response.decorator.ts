/**
 * @file api-default-conflict-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 409 Conflict response.
 */

import { ApiConflictResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/common/exception/dto/error-default.dto';
import { ConflictType } from 'src/common/exception/enum/conflict-type.enum';

/**
 * Custom Swagger decorator to standardize the 409 Conflict response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The conflict failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultConflictResponse(
    type: ConflictType = ConflictType.DEFAULT,
): MethodDecorator & ClassDecorator {
    return ApiConflictResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
