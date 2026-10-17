/**
 * @file token.port.ts
 * @description Port contract for generating and verifying JWT session, activation, email confirmation, and upload tokens.
 */

import type { SessionIdentity, SessionRegistration } from 'src/core/security/session';
import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import type { ActivationTokenPayload } from 'src/core/security/token/activation-token-payload.type';
import type { EmailConfirmationTokenPayload } from 'src/core/security/token/email-confirmation-token-payload.type';
import type { InviteTokenPayload } from 'src/core/security/token/invite-token-payload.type';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import type { UploadTokenPayload } from 'src/core/security/token/upload-token-payload.type';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Dependency injection token for the {@link ITokenPort} contract.
 */
export const TOKEN_TOKEN_PORT = Symbol();

/**
 * A freshly signed token pair with session registration metadata, including the refresh credential JTI.
 */
export type TokenPairWithSession = {
    /**
     * Signed access credential for authenticated requests.
     */
    readonly accessToken: string;

    /**
     * Signed refresh credential for rotating the session token pair.
     */
    readonly refreshToken: string;

    /**
     * Exact identity and deadlines to register before returning tokens.
     */
    readonly session: SessionRegistration;
};

/**
 * Contract for generating and verifying JWT session, activation, email confirmation, and upload tokens.
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
     *
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
     * Signs persisted invitation claims without generating identity or timestamps.
     *
     * @param payload Fixed claims loaded from the persisted invitation.
     * @returns The signed invite token.
     */
    generateInviteToken(payload: Omit<InviteTokenPayload, 'type'>): Promise<string>;

    /**
     * Signs persisted activation claims without generating identity or timestamps.
     *
     * @param payload Fixed claims loaded from the pending account.
     * @returns The signed activation token.
     */
    generateActivationToken(payload: Omit<ActivationTokenPayload, 'type'>): Promise<string>;

    /**
     * Signs persisted email request claims without generating identity or timestamps.
     *
     * @param payload Fixed claims loaded from the pending request.
     * @returns The signed email confirmation token.
     */
    generateEmailConfirmationToken(payload: Omit<EmailConfirmationTokenPayload, 'type'>): Promise<string>;

    /**
     * Signs workflow-supplied upload claims without generating identity or timestamps.
     *
     * @param payload Upload claims and expiry selected by the owning workflow.
     * @returns The signed upload token.
     */
    generateUploadToken(payload: Omit<UploadTokenPayload, 'type'>): Promise<string>;

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
     *
     * @param token Refresh token identifying the session to close.
     * @returns Verified refresh claims.
     * @throws {UnauthenticatedException} When the credential or session identity is invalid.
     */
    verifyLogoutToken(token: string): Promise<RefreshTokenPayload>;

    /**
     * Verifies an invite token's signature, type, identifiers, fixed times, and revocation version.
     *
     * @param token The JWT invite token string.
     * @returns The decoded invite token payload.
     * @throws {UnauthenticatedException} When the token is malformed, expired, too early, has an unexpected type, or lacks valid invitation claims.
     */
    verifyInviteToken(token: string): Promise<InviteTokenPayload>;

    /**
     * Verifies activation claims; the owning workflow must independently authorize the state transition.
     *
     * @param token The JWT activation token string.
     * @returns Verified activation claims.
     * @throws {UnauthenticatedException} When the token is malformed, expired, too early, has an unexpected type, or lacks valid activation claims.
     */
    verifyActivationToken(token: string): Promise<ActivationTokenPayload>;

    /**
     * Verifies email confirmation claims; callers must still check ownership and current request state.
     *
     * @param token The JWT email confirmation token string.
     * @returns Verified email confirmation claims.
     * @throws {UnauthenticatedException} When the token has an invalid signature, lifetime, type, or request claims.
     */
    verifyEmailConfirmationToken(token: string): Promise<EmailConfirmationTokenPayload>;

    /**
     * Verifies an upload proof with a required revocation snapshot; callers still check form and workflow state.
     *
     * @param token The JWT upload token string.
     * @param expectedPurpose Server-selected purpose from the owning workflow.
     * @param requireRevocationVersion Requires a valid revocation snapshot
     * @returns Verified upload claims.
     * @throws {UnauthenticatedException} When the signature, expiry, type, purpose, or claims are invalid.
     */
    verifyUploadToken(
        token: string,
        expectedPurpose: string,
        requireRevocationVersion: true,
    ): Promise<UploadTokenPayload & Required<Pick<UploadTokenPayload, 'revocationVersion'>>>;

    /**
     * Verifies upload claims, optionally requiring a revocation snapshot.
     *
     * @param token The JWT upload token string
     * @param expectedPurpose Server-selected upload purpose
     * @param requireRevocationVersion Whether a valid revocation snapshot is required; defaults to false
     * @returns Verified upload claims
     * @throws {UnauthenticatedException} When the signature, expiry, type, purpose, or required claims are invalid
     */
    verifyUploadToken(
        token: string,
        expectedPurpose: string,
        requireRevocationVersion?: boolean,
    ): Promise<UploadTokenPayload>;
}
