/**
 * @file post-refresh.dto.ts
 * @description Defines the input validation schema for token refresh requests, ensuring the provided refresh token meets JWT format requirements before attempting rotation.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsRefreshToken } from 'src/module/auth/presentation/decorator/refresh-token.decorator';

/**
 * DTO for validating token refresh requests.
 * Accepts exactly one property (the refresh token) to execute a session rotation.
 */
@Exclude()
@ApiSchema({ name: 'PostRefresh', description: 'Input validation schema for token refresh requests' })
export class PostRefreshDto {
    /**
     * The refresh token string used to obtain a new access and refresh token pair.
     * Evaluated against the cache to ensure the session is still active and valid.
     */
    @Expose()
    @IsRefreshToken('The active refresh token')
    readonly refreshToken!: string;
}
