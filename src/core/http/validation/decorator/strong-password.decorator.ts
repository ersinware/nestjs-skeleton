/**
 * @file strong-password.decorator.ts
 * @description Composed decorator bundling strength validation and OpenAPI metadata for password fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD_MIN_LENGTH = 8,
    PASSWORD_MAX_LENGTH = 128,
    PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Single source of the password-strength policy: length bounds plus at least one
 * uppercase letter, one lowercase letter, and one digit.
 *
 * @param descriptionPrefix The field label used in the Swagger description and validation error messages.
 * @returns A decorator that validates and documents a password property.
 */
export function IsStrongPassword(descriptionPrefix: string = 'The password') {
    return applyDecorators(
        IsString({ message: `${descriptionPrefix} must be a string.` }),
        IsNotEmpty({ message: `${descriptionPrefix} cannot be empty.` }),
        MinLength(PASSWORD_MIN_LENGTH, {
            message: `${descriptionPrefix} must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
        }),
        MaxLength(PASSWORD_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${PASSWORD_MAX_LENGTH} characters.`,
        }),
        Matches(PASSWORD_REGEX, {
            message: `${descriptionPrefix} is too weak. It must contain at least one uppercase letter, one lowercase letter, and one number.`,
        }),
        ApiProperty({
            type: 'string',
            pattern: PASSWORD_REGEX.source,
            minLength: PASSWORD_MIN_LENGTH,
            maxLength: PASSWORD_MAX_LENGTH,
            description: `${descriptionPrefix}. Must be at least ${PASSWORD_MIN_LENGTH} characters long and contain at least one uppercase letter, one lowercase letter, and one number.`,
            example: 'Password123!',
        }),
    );
}
