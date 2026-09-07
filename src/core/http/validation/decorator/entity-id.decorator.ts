/**
 * @file entity-id.decorator.ts
 * @description Composed decorator bundling validation and OpenAPI metadata for entity identifier fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

/**
 * Single source of the entity-identifier contract: every id in the system is a UUID v7,
 * and this decorator is where that decision is enforced and documented.
 *
 * Optionality is a parameter rather than a call-site `@IsOptional()` because the validator
 * and the OpenAPI `required` flag must agree, and only this decorator writes the latter.
 *
 * @param descriptionPrefix The field label used in the Swagger description and validation error messages.
 * @param options `optional: true` skips validation when the field is absent and documents it as not required.
 * @returns A decorator that validates and documents an entity identifier property.
 */
export function IsEntityId(
    descriptionPrefix: string = 'The unique identifier',
    options: { readonly optional?: boolean } = {},
) {
    return applyDecorators(
        ...(options.optional ? [IsOptional()] : []),
        IsNotEmpty({ message: `${descriptionPrefix} cannot be empty.` }),
        IsUUID('7', { message: `${descriptionPrefix} must be a valid UUID v7.` }),
        ApiProperty({
            type: 'string',
            format: 'uuid',
            description: `${descriptionPrefix}.`,
            example: '018f43c3-6bb3-7d72-911e-848821a837c3',
            ...(options.optional && { required: false }),
        }),
    );
}
