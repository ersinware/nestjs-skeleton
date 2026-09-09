/**
 * @file token.port.ts
 * @description Port contract for generating and verifying JWT access and refresh tokens.
 */

import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import type { InviteTokenPayload } from 'src/core/security/token/invite-token-payload.type';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import type { Principal } from 'src/shared/domain/principal';

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
     * @param principal The verified principal the tokens are minted for; its permissions go into the access token only.
     * @param sessionVersion The session version to stamp into both tokens.
     * @returns The signed token pair and the refresh token's JTI.
     */
    generateTokens(principal: Principal, sessionVersion: number): Promise<GeneratedTokens>;

    /**
     * Verifies an access token's signature, expiry, and type.
     *
     * @param token The JWT access token string.
     * @returns The decoded access token payload.
     * @throws {UnauthenticatedException} When the token is malformed, expired, too early, or has an unexpected token type.
     */
    verifyAccessToken(token: string): Promise<AccessTokenPayload>;

    /**
     * Verifies a refresh token's signature, expiry, and type.
     *
     * @param token The JWT refresh token string.
     * @returns The decoded refresh token payload.
     * @throws {UnauthenticatedException} When the token is malformed, expired, too early, or has an unexpected token type.
     */
    verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;

    /**
     * Generates a signed invite token for a pending account.
     *
     * @param id The identifier of the account the invitation activates.
     * @returns The signed invite token.
     */
    generateInviteToken(id: string): Promise<string>;

    /**
     * Verifies an invite token's signature, expiry, and type.
     *
     * @param token The JWT invite token string.
     * @returns The decoded invite token payload.
     * @throws {UnauthenticatedException} When the token is malformed, expired, too early, or has an unexpected token type.
     */
    verifyInviteToken(token: string): Promise<InviteTokenPayload>;
}
