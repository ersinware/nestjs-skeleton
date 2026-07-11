/**
 * @file email.decorator.ts
 * @description Custom composite decorator to enforce validation and documentation for email fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

const EMAIL_MAX_LENGTH = 255;

/**
 * Combined decorator to validate that a property contains a properly formatted email.
 * Applies Swagger metadata and class-validator restrictions.
 *
 * @param descriptionPrefix The prefix description used in Swagger documentation and validation error messages.
 * @returns A decorator that validates and documents email properties.
 */
export function IsUserEmail(descriptionPrefix: string = 'The email address') {
    return applyDecorators(
        IsEmail(),
        IsNotEmpty(),
        MaxLength(EMAIL_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${EMAIL_MAX_LENGTH} characters.`,
        }),
        ApiProperty({
            type: 'string',
            format: 'email',
            minLength: 5,
            maxLength: EMAIL_MAX_LENGTH,
            description: `${descriptionPrefix}.`,
            example: 'user@example.com',
        }),
    );
}
