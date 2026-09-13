/**
 * @file person-name.decorator.ts
 * @description Composed decorator bundling validation and OpenAPI metadata for person-name fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_MIN_LENGTH = 2,
    NAME_MAX_LENGTH = 100,
    NAME_LABEL = 'The full name',
    // Require a letter first and absolute end-of-input, rejecting trailing line breaks too.
    NAME_REGEX = /^\p{L}[\p{L}\p{M} .’'-]*(?![\s\S])/u;

/**
 * Single source of the person-name field contract: enforces length bounds, an initial letter,
 * and Unicode letters/marks with spaces, periods, apostrophes, and hyphens.
 *
 * @returns A decorator that validates and documents a person-name property.
 */
export function IsPersonName() {
    return applyDecorators(
        IsString({ message: `${NAME_LABEL} must be a string.` }),
        IsNotEmpty({ message: `${NAME_LABEL} cannot be empty.` }),
        MinLength(NAME_MIN_LENGTH, {
            message: `${NAME_LABEL} must be at least ${NAME_MIN_LENGTH} characters long.`,
        }),
        MaxLength(NAME_MAX_LENGTH, {
            message: `${NAME_LABEL} cannot exceed ${NAME_MAX_LENGTH} characters.`,
        }),
        Matches(NAME_REGEX, {
            message: `${NAME_LABEL} must start with a letter and contain only letters, combining marks, spaces, periods, apostrophes, or hyphens.`,
        }),
        ApiProperty({
            type: 'string',
            pattern: NAME_REGEX.source,
            minLength: NAME_MIN_LENGTH,
            maxLength: NAME_MAX_LENGTH,
            description: `${NAME_LABEL}.`,
            example: 'John Doe',
        }),
    );
}
