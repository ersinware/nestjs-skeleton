/**
 * @file password.decorator.ts
 * @description Custom composite decorator to enforce strength validation and documentation for password fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD_MIN_LENGTH = 8,
    PASSWORD_MAX_LENGTH = 128,
    PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Combined decorator to validate that a property contains a strong password.
 * Enforces length constraints and demands at least one uppercase letter, one lowercase letter, and one number.
 *
 * @param descriptionPrefix The prefix description used in Swagger documentation and validation error messages.
 * @returns A decorator that validates and documents password properties.
 */
export function IsStrongPassword(descriptionPrefix: string = 'The password') {
    return applyDecorators(
        IsString(),
        IsNotEmpty(),
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
            description: `${descriptionPrefix}. Must be at least ${PASSWORD_MIN_LENGTH} characters long and contain at least one uppercase letter, one lowercase letter, and one number.`,
            minLength: PASSWORD_MIN_LENGTH,
            maxLength: PASSWORD_MAX_LENGTH,
            example: 'Password123!',
        }),
    );
}
