/**
 * @file token.port.ts
 * @description Port contract for generating and verifying JWT access and refresh tokens.
 */

import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import type { AuthRole } from 'src/shared/domain/auth-role';

/**
 * Dependency injection token for the {@link ITokenPort} contract.
 */
export const TOKEN_TOKEN_PORT = Symbol('TOKEN_TOKEN_PORT');

/**
 * A freshly signed token pair. `refreshTokenJti` is the JTI minted into the REFRESH token only — the
 * handle session storage tracks for rotation and reuse detection; the access token carries none.
 */
export type GeneratedTokens = {
    accessToken: string;
    refreshToken: string;
    refreshTokenJti: string;
};

/**
 * Contract for generating and verifying JWT access and refresh tokens.
 */
export interface ITokenPort {
    /**
     * Generates a signed access/refresh token pair.
     *
     * @param role The principal's authentication role.
     * @param id The principal identifier.
     * @param sessionVersion The session version to stamp into both tokens.
     * @returns The signed token pair and the refresh token's JTI.
     */
    generateTokens(role: AuthRole, id: string, sessionVersion: number): Promise<GeneratedTokens>;

    /**
     * Verifies an access token's signature and expiry.
     *
     * @param token The JWT access token string.
     * @returns The decoded access token payload.
     * @throws {JsonWebTokenError} When the token is malformed or its signature is invalid;
     * `TokenExpiredError` (a subclass) when it is expired.
     */
    verifyAccessToken(token: string): Promise<AccessTokenPayload>;

    /**
     * Verifies a refresh token's signature and expiry.
     *
     * @param token The JWT refresh token string.
     * @returns The decoded refresh token payload.
     * @throws {JsonWebTokenError} When the token is malformed or its signature is invalid;
     * `TokenExpiredError` (a subclass) when it is expired.
     */
    verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;
}
