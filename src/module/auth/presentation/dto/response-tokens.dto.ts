/**
 * @file response-tokens.dto.ts
 * @description Response DTO returning a freshly issued JWT token pair.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsRefreshToken, TOKEN_MAX_LENGTH } from 'src/module/auth/presentation/decorator/refresh-token.decorator';

/**
 * Returns the issued token pair; the class-level whitelist guarantees nothing else ever reaches
 * the response body.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseTokens',
    description: 'Output response schema containing access and refresh JWT tokens',
})
export class ResponseTokensDto {
    /**
     * The short-lived access token, sent as a Bearer token on protected routes.
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
     * The long-lived refresh token, exchanged for a new token pair when the access token expires.
     */
    @Expose()
    @IsRefreshToken('The newly issued refresh token')
    readonly refreshToken!: string;
}
