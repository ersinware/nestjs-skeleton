/**
 * @file uuid-id.decorator.ts
 * @description Validates and documents UUID identifiers with a selectable version.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, ValidateIf } from 'class-validator';

/**
 * Bundles UUID validation and OpenAPI metadata; UUID v7 remains the default for entity IDs.
 *
 * Optionality and nullability are declared here so validation and OpenAPI agree.
 *
 * @param descriptionPrefix Field label used in validation messages and the Swagger description
 * @param options UUID version, optionality, and nullability of the field
 * @returns A decorator validating and documenting a UUID identifier
 */
export function isUUID(
    descriptionPrefix: string = 'The unique identifier',
    options: { readonly version?: '7' | 'all'; readonly optional?: boolean; readonly nullable?: boolean } = {},
): PropertyDecorator {
    const version = options.version ?? '7';

    return applyDecorators(
        ValidateIf(
            (_object, value: unknown) =>
                !(options.optional && value === undefined) && !(options.nullable && value === null),
        ),
        IsNotEmpty({ message: `${descriptionPrefix} cannot be empty.` }),
        IsUUID(version, { message: `${descriptionPrefix} must be a valid UUID${version === '7' ? ' v7' : ''}.` }),
        ApiProperty({
            type: 'string',
            format: 'uuid',
            description: `${descriptionPrefix}.`,
            example: version === '7' ? '018f43c3-6bb3-7d72-911e-848821a837c3' : 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f',
            ...(options.optional && { required: false }),
            ...(options.nullable && { nullable: true }),
        }),
    );
}
