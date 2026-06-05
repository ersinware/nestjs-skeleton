/**
 * @file get-auth-tokens.dto.ts
 * @description Output response DTO for authentication credentials.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsRefreshToken } from '../decorator/refresh-token.decorator';
import { TOKEN_MAX_LENGTH } from '../constant/auth.constant';

/**
 * Output DTO returning access and refresh JWT tokens using class-transformer exclusions.
 */
@Exclude()
@ApiSchema({ name: 'GetAuthTokens', description: 'Output response schema containing access and refresh JWT tokens' })
export class GetAuthTokensDto {
    /**
     * Short-lived JWT access token.
     */
    @Expose()
    @IsString()
    @IsNotEmpty()
    @IsJWT()
    @MaxLength(TOKEN_MAX_LENGTH)
    @ApiProperty({
        description: 'JWT Access Token.',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        format: 'jwt',
        maxLength: TOKEN_MAX_LENGTH,
    })
    readonly accessToken!: string;

    /**
     * Long-lived JWT refresh token.
     */
    @Expose()
    @IsRefreshToken('JWT Refresh Token.')
    readonly refreshToken!: string;
}
