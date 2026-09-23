/**
 * @file token.port.ts
 * @description Port contract for generating and verifying JWT access, refresh, and invite tokens.
 */

import type { SessionIdentity, SessionRegistration } from 'src/core/security/session';
import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import type { InviteTokenPayload } from 'src/core/security/token/invite-token-payload.type';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Dependency injection token for the {@link ITokenPort} contract.
 */
export const TOKEN_TOKEN_PORT = Symbol('TOKEN_TOKEN_PORT');

/**
 * A freshly signed token pair with session registration metadata, including the refresh credential JTI.
 */
export type TokenPairWithSession = {
    /** Signed access credential for authenticated requests. */
    readonly accessToken: string;

    /** Signed refresh credential for rotating the session token pair. */
    readonly refreshToken: string;

    /** Exact identity and deadlines to register before returning tokens. */
    readonly session: SessionRegistration;
};

/**
 * Contract for generating and verifying JWT access, refresh, and invite tokens.
 */
export interface ITokenPort {
    /**
     * Creates a fresh session identity and its signed access/refresh token pair.
     *
     * @param principal The verified principal the tokens are minted for; its permissions go into the access token only.
     * @param sessionVersion The session version to stamp into both tokens.
     * @returns The signed token pair and session registration metadata.
     */
    generateTokens(principal: Principal, sessionVersion: number): Promise<TokenPairWithSession>;

    /**
     * Signs replacement credentials with the existing session identity and absolute deadline.
     * @param principal Verified owner and current permissions.
     * @param sessionVersion Current account version.
     * @param identity Existing session identity to preserve.
     * @returns The signed token pair and session registration metadata.
     * @throws {UnauthenticatedException} When the absolute session deadline has passed.
     */
    refreshTokens(
        principal: Principal,
        sessionVersion: number,
        identity: SessionIdentity,
    ): Promise<TokenPairWithSession>;

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
     * Verifies a refresh credential for closing its session, allowing credential expiry only.
     * Absolute expiry and all signature, type, and session claim checks still apply.
     * @param token Refresh token identifying the session to close.
     * @returns Verified refresh claims.
     * @throws {UnauthenticatedException} When the credential or session identity is invalid.
     */
    verifyLogoutToken(token: string): Promise<RefreshTokenPayload>;

    /**
     * Signs persisted invitation claims without generating identity or timestamps.
     *
     * @param invitation Fixed claims loaded from the persisted invitation.
     * @returns The signed invite token.
     */
    generateInviteToken(invitation: Omit<InviteTokenPayload, 'type'>): Promise<string>;

    /**
     * Verifies an invite token's signature, type, identifiers, fixed times, and revocation version.
     *
     * @param token The JWT invite token string.
     * @returns The decoded invite token payload.
     * @throws {UnauthenticatedException} When the token is malformed, expired, too early, has an unexpected type, or lacks valid invitation claims.
     */
    verifyInviteToken(token: string): Promise<InviteTokenPayload>;
}
