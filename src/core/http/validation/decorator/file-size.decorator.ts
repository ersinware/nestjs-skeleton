/**
 * @file file-size.decorator.ts
 * @description Composed validation and OpenAPI metadata for workflow-limited file sizes.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Validates a non-empty byte count without coercion; the owning workflow selects the limit.
 *
 * @param maxSizeBytes Maximum file size permitted by the workflow
 * @param descriptionPrefix Field label used in validation messages and documentation
 * @returns A decorator validating and documenting the file size
 */
export function IsFileSize(maxSizeBytes: number, descriptionPrefix: string = 'The file size'): PropertyDecorator {
    return applyDecorators(
        IsInt({ message: `${descriptionPrefix} must be an integer.` }),
        Min(1, { message: `${descriptionPrefix} must be at least 1 byte.` }),
        Max(maxSizeBytes, { message: `${descriptionPrefix} cannot exceed ${maxSizeBytes} bytes.` }),
        ApiProperty({
            type: 'integer',
            minimum: 1,
            maximum: maxSizeBytes,
            description: `${descriptionPrefix} in bytes.`,
            example: maxSizeBytes,
        }),
    );
}
