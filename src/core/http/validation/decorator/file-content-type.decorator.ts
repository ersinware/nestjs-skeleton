/**
 * @file file-content-type.decorator.ts
 * @description Composed validation and OpenAPI metadata for workflow-approved file media types.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

/**
 * Validates the declared media type without normalizing machine identifiers.
 *
 * @param contentTypes Media types permitted by the owning workflow
 * @param descriptionPrefix Field label used in validation messages and documentation
 * @returns A decorator validating and documenting the declared media type
 */
export function IsFileContentType(
    contentTypes: readonly [string, ...string[]],
    descriptionPrefix: string = 'The file content type',
): PropertyDecorator {
    return applyDecorators(
        IsString({ message: `${descriptionPrefix} must be a string.` }),
        IsIn(contentTypes, { message: `${descriptionPrefix} must be one of: ${contentTypes.join(', ')}.` }),
        ApiProperty({
            type: String,
            enum: [...contentTypes],
            description: `${descriptionPrefix}.`,
            example: contentTypes[0],
        }),
    );
}
