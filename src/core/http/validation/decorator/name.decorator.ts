/**
 * @file name.decorator.ts
 * @description Custom composite decorator to enforce validation and documentation for name fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_MIN_LENGTH = 2,
    NAME_MAX_LENGTH = 100,
    // eslint-disable-next-line no-control-regex
    NAME_REGEX = /^[^0-9\x00]+$/;

/**
 * Combined decorator to validate that a property contains a valid name.
 * Disallows numbers, control characters, and enforces length constraints.
 *
 * @param descriptionPrefix The prefix description used in Swagger documentation and validation error messages.
 * @returns A decorator that validates and documents name properties.
 */
export function IsUserName(descriptionPrefix: string = 'The full name') {
    return applyDecorators(
        IsString(),
        IsNotEmpty(),
        MinLength(NAME_MIN_LENGTH, {
            message: `${descriptionPrefix} must be at least ${NAME_MIN_LENGTH} characters long.`,
        }),
        MaxLength(NAME_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${NAME_MAX_LENGTH} characters.`,
        }),
        Matches(NAME_REGEX, {
            message: `${descriptionPrefix} must not contain numbers.`,
        }),
        ApiProperty({
            type: 'string',
            pattern: NAME_REGEX.source,
            minLength: NAME_MIN_LENGTH,
            maxLength: NAME_MAX_LENGTH,
            description: `${descriptionPrefix}.`,
            example: 'John Doe',
        }),
    );
}
