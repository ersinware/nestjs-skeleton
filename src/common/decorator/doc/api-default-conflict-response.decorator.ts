/**
 * @file api-default-conflict-response.decorator.ts
 * @description Custom Swagger decorator to standardize the 409 Conflict response.
 */

import { ApiConflictResponse } from '@nestjs/swagger';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { ConflictType } from 'src/common/enum/error/conflict-type.enum';

export { ConflictType };

/**
 * Custom Swagger decorator to standardize the 409 Conflict response.
 * Uses the default ErrorDefaultDto and standard error message.
 *
 * @param type The conflict failure type.
 * @returns A decorator function that can be applied to controllers or methods.
 */
export function ApiDefaultConflictResponse(
    type: ConflictType = ConflictType.EMAIL_IN_USE,
): MethodDecorator & ClassDecorator {
    return ApiConflictResponse({
        description: type,
        type: ErrorDefaultDto,
    });
}
