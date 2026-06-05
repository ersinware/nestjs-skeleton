/**
 * @file post-auth-refresh.dto.ts
 * @description Input validation DTO for authentication refresh token requests.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsRefreshToken } from '../decorator/refresh-token.decorator';

/**
 * DTO for validating token refresh requests.
 */
@ApiSchema({ name: 'PostAuthRefresh', description: 'Input validation schema for token refresh requests' })
export class PostAuthRefreshDto {
    /**
     * The refresh token string used to obtain a new access and refresh token pair.
     */
    @IsRefreshToken('The active refresh token.')
    readonly refreshToken!: string;
}
