/**
 * @file response-tokens.dto.ts
 * @description Defines the output schema for authentication credentials, standardizing how JWT pairs are returned to the client upon successful login or refresh.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsRefreshToken } from 'src/module/auth/presentation/decorator/refresh-token.decorator';
import { TOKEN_MAX_LENGTH } from 'src/module/auth/presentation/token-length.constraint';

/**
 * Output DTO returning access and refresh JWT tokens.
 * Utilizes class-transformer to guarantee that only the explicitly exposed tokens are returned in the HTTP response body.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseTokens',
    description: 'Output response schema containing access and refresh JWT tokens',
})
export class ResponseTokensDto {
    /**
     * Short-lived JWT access token.
     * Contains the principal's claims and is used as a Bearer token in the Authorization header for protected routes.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        format: 'jwt',
        minLength: 1,
        maxLength: TOKEN_MAX_LENGTH,
        description: 'JWT Access Token.',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    })
    readonly accessToken!: string;

    /**
     * Long-lived JWT refresh token.
     * Used exclusively to obtain a fresh access token pair when the current access token expires.
     */
    @Expose()
    @IsRefreshToken('JWT Refresh Token.')
    readonly refreshToken!: string;
}
