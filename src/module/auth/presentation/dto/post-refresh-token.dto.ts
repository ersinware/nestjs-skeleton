/**
 * @file post-refresh-token.dto.ts
 * @description Request DTO carrying the refresh token a session operation acts on.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsJwtToken } from 'src/core/http';

/**
 * Validates the refresh token at the transport boundary; shared by the refresh and logout routes,
 * which act on the same single-token payload.
 */
@ApiSchema({ name: 'PostRefreshToken', description: 'Refresh token payload for token rotation or session logout.' })
export class PostRefreshTokenDto {
    /**
     * The refresh token to rotate or revoke.
     */
    @IsJwtToken('The active refresh token')
    readonly refreshToken!: string;
}
