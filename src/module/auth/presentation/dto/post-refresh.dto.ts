/**
 * @file post-refresh.dto.ts
 * @description Request DTO carrying the refresh token a session operation acts on.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsRefreshToken } from 'src/module/auth/presentation/decorator/refresh-token.decorator';

/**
 * Validates the refresh token at the transport boundary; shared by the refresh and logout routes,
 * which act on the same single-token payload.
 */
@Exclude()
@ApiSchema({ name: 'PostRefresh', description: 'Input validation schema for token refresh requests' })
export class PostRefreshDto {
    /**
     * The refresh token to rotate or revoke.
     */
    @Expose()
    @IsRefreshToken('The active refresh token')
    readonly refreshToken!: string;
}
