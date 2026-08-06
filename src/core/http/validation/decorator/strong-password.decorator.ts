/**
 * @file strong-password.decorator.ts
 * @description Composed decorator bundling strength validation and OpenAPI metadata for password fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_REGEX } from 'src/core/security/password';

/**
 * Validates and documents a password field against the password policy
 * (`core/security/password`): length bounds plus at least one uppercase letter,
 * one lowercase letter, and one digit.
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
