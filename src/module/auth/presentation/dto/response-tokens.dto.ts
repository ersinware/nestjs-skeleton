/**
 * @file response-tokens.dto.ts
 * @description Response DTO returning a freshly issued JWT token pair.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken } from 'src/core/http';

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
    @IsJwtToken('JWT Access Token')
    readonly accessToken!: string;

    /**
     * The long-lived refresh token, exchanged for a new token pair when the access token expires.
     */
    @Expose()
    @IsJwtToken('The newly issued refresh token')
    readonly refreshToken!: string;
}
