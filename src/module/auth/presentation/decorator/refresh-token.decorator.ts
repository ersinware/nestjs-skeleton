/**
 * @file refresh-token.decorator.ts
 * @description Provides a custom composite decorator to DRY up validation and OpenAPI documentation for JWT refresh tokens across multiple DTOs.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TOKEN_MAX_LENGTH } from 'src/module/auth/presentation/constant/constant';

/**
 * Applies strict JWT formatting and length validations alongside standardized Swagger documentation for a refresh token property.
 *
 * @param description The description override used in the Swagger OpenAPI specification
 * @returns A decorator that validates and documents refresh token properties
 */
export function IsRefreshToken(description: string = 'The active refresh token.') {
    return applyDecorators(
        IsString(),
        IsNotEmpty(),
        IsJWT(),
        MaxLength(TOKEN_MAX_LENGTH),
        ApiProperty({
            type: 'string',
            format: 'jwt',
            maxLength: TOKEN_MAX_LENGTH,
            description,
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        }),
    );
}
