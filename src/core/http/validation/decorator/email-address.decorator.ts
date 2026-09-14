/**
 * @file email-address.decorator.ts
 * @description Composed decorator bundling validation and OpenAPI metadata for email address fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { Trim } from 'src/core/http/validation/decorator/trim.decorator';

const EMAIL_MIN_LENGTH = 5,
    EMAIL_MAX_LENGTH = 255,
    EMAIL_LABEL = 'The email address';

/**
 * Single source of the email-address field contract: every limit lives here once and
 * feeds both the validation rules and the OpenAPI schema.
 *
 * @param options Disable normalization on response DTOs to preserve stored values.
 * @returns A decorator that trims, validates and documents an email address property.
 */
export function IsEmailAddress(options: { readonly normalize?: boolean } = {}): PropertyDecorator {
    return applyDecorators(
        ...(options.normalize === false ? [] : [Trim()]),
        IsEmail(undefined, { message: `${EMAIL_LABEL} must be a valid email address.` }),
        IsNotEmpty({ message: `${EMAIL_LABEL} cannot be empty.` }),
        MinLength(EMAIL_MIN_LENGTH, {
            message: `${EMAIL_LABEL} must be at least ${EMAIL_MIN_LENGTH} characters long.`,
        }),
        MaxLength(EMAIL_MAX_LENGTH, {
            message: `${EMAIL_LABEL} cannot exceed ${EMAIL_MAX_LENGTH} characters.`,
        }),
        ApiProperty({
            type: 'string',
            format: 'email',
            minLength: EMAIL_MIN_LENGTH,
            maxLength: EMAIL_MAX_LENGTH,
            description: `${EMAIL_LABEL}.` + (options.normalize === false ? '' : ' Trimmed before validation.'),
            example: 'user@example.com',
        }),
    );
}
