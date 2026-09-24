/**
 * @file post-refresh.dto.ts
 * @description Request DTO carrying the refresh token a session operation acts on.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsJwtToken } from 'src/core/http';

/**
 * Validates the refresh token at the transport boundary; shared by the refresh and logout routes,
 * which act on the same single-token payload.
 */
@ApiSchema({ name: 'PostRefresh', description: 'Input validation schema for token refresh requests' })
export class PostRefreshDto {
    /**
     * The refresh token to rotate or revoke.
     */
    @IsJwtToken('The active refresh token')
    readonly refreshToken!: string;
}
