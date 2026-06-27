/**
 * @file token.service.interface.ts
 * @description Contract for the TokenService.
 */

import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { AccessTokenPayload } from 'src/common/auth/interface/access-token-payload.interface';
import { RefreshTokenPayload } from 'src/common/auth/interface/refresh-token-payload.interface';

export interface ITokenService {
    /**
     * Generates a signed JWT access token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param expiresIn Optional expiration duration override.
     * @returns A promise resolving to the generated access token.
     */
    generateAccessToken(role: AuthUserRole, id: string, expiresIn?: string | number): Promise<string>;

    /**
     * Generates a signed JWT refresh token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique refresh token identifier.
     * @param expiresIn Optional expiration duration override.
     * @returns A promise resolving to the generated refresh token.
     */
    generateRefreshToken(role: AuthUserRole, id: string, jti: string, expiresIn?: string | number): Promise<string>;

    /**
     * Generates a pair of JWT access and refresh tokens.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns Object containing the generated access token, refresh token, and JTI.
     */
    generateTokens(role: AuthUserRole, id: string): Promise<{ accessToken: string; refreshToken: string; jti: string }>;

    /**
     * Verifies an access token.
     *
     * @param token The JWT access token string.
     * @returns The parsed access token payload.
     */
    verifyAccessToken(token: string): Promise<AccessTokenPayload>;

    /**
     * Verifies a refresh token.
     *
     * @param token The JWT refresh token string.
     * @returns The parsed refresh token payload.
     */
    verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;
}
