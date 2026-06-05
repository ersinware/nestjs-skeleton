/**
 * @file entity-id.decorator.ts
 * @description Custom composite decorator to enforce validation and documentation for database identifiers (IDs).
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * Combined decorator to validate that a property contains a valid UUID v7.
 *
 * @param descriptionPrefix The prefix description used in Swagger documentation and validation error messages.
 * @returns A decorator that validates and documents the entity identifier property.
 */
export function IsEntityId(descriptionPrefix: string = 'The unique identifier') {
    return applyDecorators(
        IsNotEmpty({ message: `${descriptionPrefix} cannot be empty.` }),
        IsUUID('7', { message: `${descriptionPrefix} must be a valid UUID v7.` }),
        ApiProperty({
            type: 'string',
            format: 'uuid',
            description: `${descriptionPrefix}.`,
            example: '018f43c3-6bb3-7d72-911e-848821a837c3',
        }),
    );
}
