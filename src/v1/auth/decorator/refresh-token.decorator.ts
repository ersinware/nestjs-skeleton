/**
 * @file refresh-token.decorator.ts
 * @description Custom composite decorator to enforce validation and documentation for JWT refresh tokens.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TOKEN_MAX_LENGTH } from '../constant/auth.constant';

/**
 * Combined decorator to validate and document a JWT refresh token property.
 * Applies Swagger metadata and class-validator restrictions.
 *
 * @param description The description used in Swagger documentation.
 * @returns A decorator that validates and documents refresh token properties.
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
            description,
            maxLength: TOKEN_MAX_LENGTH,
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        }),
    );
}
