/**
 * @file token.service.interface.ts
 * @description Contract for the TokenService.
 */

import type { AccessTokenPayload, AuthRole, RefreshTokenPayload } from 'src/core/security/auth';

export const TOKEN_TOKEN_PORT = Symbol('TOKEN_TOKEN_PORT');

export interface ITokenPort {
    /**
     * Generates a signed JWT access token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param version The session version to stamp into the token.
     * @returns A promise resolving to the generated access token.
     */
    generateAccessToken(role: AuthRole, id: string, version: number): Promise<string>;

    /**
     * Generates a signed JWT refresh token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique refresh token identifier.
     * @param version The session version to stamp into the token.
     * @returns A promise resolving to the generated refresh token.
     */
    generateRefreshToken(role: AuthRole, id: string, jti: string, version: number): Promise<string>;

    /**
     * Generates a pair of JWT access and refresh tokens.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param version The session version to stamp into both tokens.
     * @returns Object containing the generated access token, refresh token, and JTI.
     */
    generateTokens(
        role: AuthRole,
        id: string,
        version: number,
    ): Promise<{ accessToken: string; refreshToken: string; jti: string }>;

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
