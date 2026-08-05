/**
 * @file refresh-token.decorator.ts
 * @description Provides a custom composite decorator to DRY up validation and OpenAPI documentation for JWT refresh tokens across multiple DTOs.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TOKEN_MAX_LENGTH } from 'src/module/auth/presentation/token-length.constraint';

/**
 * Applies strict JWT formatting and length validations alongside standardized Swagger documentation for a refresh token property.
 *
 * @param descriptionPrefix The prefix description used in Swagger documentation and validation error messages
 * @returns A decorator that validates and documents refresh token properties
 */
export function IsRefreshToken(descriptionPrefix: string = 'The refresh token') {
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
            maxLength: TOKEN_MAX_LENGTH,
            description: `${descriptionPrefix}.`,
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        }),
    );
}
