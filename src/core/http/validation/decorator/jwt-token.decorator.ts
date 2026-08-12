/**
 * @file jwt-token.decorator.ts
 * @description Composed validation and Swagger decorator for JWT-carrying DTO properties, with the shared token length limit.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Maximum accepted JWT length — bounds the payload before any parsing so an oversized token cannot
 * be used as a denial-of-service vector.
 */
export const TOKEN_MAX_LENGTH = 2048;

/**
 * Bundles the JWT validation rules and the ApiProperty metadata of a token property, so every limit
 * lives in one place.
 *
 * @param descriptionPrefix The field label feeding the Swagger description and the error messages
 * @returns A decorator validating and documenting a JWT property
 */
export function IsJwtToken(descriptionPrefix: string = 'The token') {
    return applyDecorators(
        IsString({ message: `${descriptionPrefix} must be a string.` }),
        IsNotEmpty({ message: `${descriptionPrefix} cannot be empty.` }),
        IsJWT({ message: `${descriptionPrefix} must be a valid JWT.` }),
        MaxLength(TOKEN_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${TOKEN_MAX_LENGTH} characters.`,
        }),
        ApiProperty({
            type: 'string',
            format: 'jwt',
            minLength: 1,
            maxLength: TOKEN_MAX_LENGTH,
            description: `${descriptionPrefix}.`,
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        }),
    );
}
