/**
 * @file token.adapter.ts
 * @description JWT-backed adapter implementing the token port.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { JsonWebTokenError } from 'jsonwebtoken';
import { ENV, parseTtlToSeconds } from 'src/core/config';
import type { SessionIdentity } from 'src/core/security/session';
import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { EmailConfirmationTokenPayload } from 'src/core/security/token/email-confirmation-token-payload.type';
import type { InviteTokenPayload } from 'src/core/security/token/invite-token-payload.type';
import type { ITokenPort, TokenPairWithSession } from 'src/core/security/token/port/token.port';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import { Permission, PrincipalType, type Principal } from 'src/shared/domain/principal';
import { UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Fixed claim catalogs avoid rebuilding lookup arrays on each authenticated request.
 */
const PERMISSIONS: ReadonlySet<unknown> = new Set(Object.values(Permission));

/**
 * Allowed principal kinds for runtime validation of decoded JWT claims.
 */
const PRINCIPAL_TYPES: ReadonlySet<unknown> = new Set(Object.values(PrincipalType));

/**
 * Session and credential identifiers are server-generated UUID v4 values.
 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Implements {@link ITokenPort} with signed JWTs, using separate secrets and lifetimes
 * per token type so a leaked access secret cannot forge refresh tokens.
 */
@Injectable()
export class TokenAdapter implements ITokenPort {
    /**
     * Access token lifetime, read once at boot — config is immutable after validation.
     */
    private readonly accessTtl: number;

    /**
     * Refresh token lifetime, read once at boot — config is immutable after validation.
     */
    private readonly refreshTtl: number;

    /**
     * Fixed maximum login lifetime in seconds for every principal kind.
     */
    private readonly sessionTtlByPrincipalType: Readonly<Record<PrincipalType, number>>;

    /**
     * Access token signing secret, read once at boot — config is immutable after validation.
     */
    private readonly accessSecret: string;

    /**
     * Refresh token signing secret, read once at boot — config is immutable after validation.
     */
    private readonly refreshSecret: string;

    /**
     * Invite token signing secret, read once at boot — config is immutable after validation.
     */
    private readonly inviteSecret: string;

    /**
     * Separate signing secret for email change proofs.
     */
    private readonly emailConfirmationSecret: string;

    /**
     * Reads every per-type secret and lifetime once at boot, so a missing variable fails startup
     * instead of the first token operation.
     *
     * @param jwtService Signs and verifies JWTs
     * @param configService Provides the per-type secrets and lifetimes
     */
    constructor(
        private readonly jwtService: JwtService,
        configService: ConfigService,
    ) {
        this.accessTtl = parseTtlToSeconds(configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL));
        this.refreshTtl = parseTtlToSeconds(configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL));
        this.sessionTtlByPrincipalType = {
            [PrincipalType.ADMIN]: parseTtlToSeconds(configService.getOrThrow<string>(ENV.SESSION_ABSOLUTE_TTL_ADMIN)),
            [PrincipalType.USER]: parseTtlToSeconds(configService.getOrThrow<string>(ENV.SESSION_ABSOLUTE_TTL_USER)),
        } satisfies Record<PrincipalType, number>;
        this.accessSecret = configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
        this.refreshSecret = configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET);
        this.inviteSecret = configService.getOrThrow<string>(ENV.JWT_INVITE_SECRET);
        this.emailConfirmationSecret = configService.getOrThrow<string>(ENV.JWT_EMAIL_CONFIRM_SECRET);
    }

    /**
     * Creates a fresh session identity and signs its first credential pair.
     * @param principal Verified owner and current permissions.
     * @param sessionVersion Current account version.
     * @returns Credentials and the exact metadata required by the session store.
     */
    async generateTokens(principal: Principal, sessionVersion: number): Promise<TokenPairWithSession> {
        return this.refreshTokens(principal, sessionVersion, {
            sid: crypto.randomUUID(),
            sessionExpiresAt: Math.floor(Date.now() / 1000) + this.sessionTtlByPrincipalType[principal.type],
        });
    }

    /**
     * Signs a credential pair while preserving the supplied session identity and absolute deadline.
     * @param principal Verified owner and current permissions.
     * @param sessionVersion Current account version.
     * @param identity Session identity whose deadline must remain unchanged.
     * @returns Credentials and the exact metadata required by the session store.
     */
    async refreshTokens(
        principal: Principal,
        sessionVersion: number,
        identity: SessionIdentity,
    ): Promise<TokenPairWithSession> {
        const now = Math.floor(Date.now() / 1000);

        if (identity.sessionExpiresAt <= now) {
            throw new UnauthenticatedException();
        }

        const refreshTokenJti = crypto.randomUUID(),
            refreshExpiresAt = Math.min(now + this.refreshTtl, identity.sessionExpiresAt),
            accessExpiresAt = Math.min(now + this.accessTtl, identity.sessionExpiresAt),
            claims = {
                sub: principal.id,
                principalType: principal.type,
                sid: identity.sid,
                sessionExpiresAt: identity.sessionExpiresAt,
                sessionVersion,
            },
            [accessToken, refreshToken] = await Promise.all([
                this.jwtService.signAsync(
                    { ...claims, permissions: principal.permissions, exp: accessExpiresAt, type: AuthTokenType.ACCESS },
                    { secret: this.accessSecret, algorithm: 'HS256', noTimestamp: true },
                ),
                this.jwtService.signAsync(
                    { ...claims, jti: refreshTokenJti, exp: refreshExpiresAt, type: AuthTokenType.REFRESH },
                    { secret: this.refreshSecret, algorithm: 'HS256', noTimestamp: true },
                ),
            ]);

        return {
            accessToken,
            refreshToken,
            session: {
                sessionVersion,
                sid: identity.sid,
                sessionExpiresAt: identity.sessionExpiresAt,
                principalType: principal.type,
                refreshTokenJti,
                refreshExpiresAt,
            },
        };
    }

    /**
     * Signs the same persisted invitation claims in a fixed order on every delivery.
     *
     * @param payload Fixed claims loaded from one persisted invitation
     * @returns The signed invite token
     */
    async generateInviteToken(payload: Omit<InviteTokenPayload, 'type'>): Promise<string> {
        return this.jwtService.signAsync(
            {
                sub: payload.sub,
                jti: payload.jti,
                inviteRevocationVersion: payload.inviteRevocationVersion,
                exp: payload.exp,
                type: AuthTokenType.INVITE,
            },
            { secret: this.inviteSecret, algorithm: 'HS256', noTimestamp: true },
        );
    }

    /**
     * Signs persisted email request claims in a fixed order without extending their lifetime.
     *
     * @param payload Fixed claims loaded from the pending request
     * @returns The signed email confirmation token
     */
    async generateEmailConfirmationToken(payload: Omit<EmailConfirmationTokenPayload, 'type'>): Promise<string> {
        return this.jwtService.signAsync(
            {
                sub: payload.sub,
                principalType: payload.principalType,
                jti: payload.jti,
                emailRevocationVersion: payload.emailRevocationVersion,
                exp: payload.exp,
                type: AuthTokenType.EMAIL_CONFIRM,
            },
            { secret: this.emailConfirmationSecret, algorithm: 'HS256', noTimestamp: true },
        );
    }

    /**
     * Verifies an access token's signature, expiry, and type.
     *
     * @param token The JWT access token string
     * @returns The decoded access token payload
     */
    async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
        const payload = await this.verifyToken<AccessTokenPayload>(token, this.accessSecret, AuthTokenType.ACCESS);
        this.assertSessionClaims(payload);

        if (
            !Array.isArray(payload.permissions) ||
            !payload.permissions.every((permission) => PERMISSIONS.has(permission))
        ) {
            throw new UnauthenticatedException();
        }

        return payload;
    }

    /**
     * Verifies a refresh token's signature, expiry, and type.
     *
     * @param token The JWT refresh token string
     * @returns The decoded refresh token payload
     */
    async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
        const payload = await this.verifyToken<RefreshTokenPayload>(token, this.refreshSecret, AuthTokenType.REFRESH);

        this.assertSessionClaims(payload);
        this.assertRefreshJti(payload.jti);

        return payload;
    }

    /**
     * Allows an expired rotated credential to close its still-live session.
     * @param token Signed refresh credential.
     * @returns Verified owner and session identity.
     */
    async verifyLogoutToken(token: string): Promise<RefreshTokenPayload> {
        const payload = await this.verifyToken<RefreshTokenPayload>(
            token,
            this.refreshSecret,
            AuthTokenType.REFRESH,
            true,
        );

        this.assertSessionClaims(payload);
        this.assertRefreshJti(payload.jti);

        return payload;
    }

    /**
     * Verifies an invite token's signature, expiry, type, and revocation version.
     *
     * @param token The JWT invite token string
     * @returns The decoded invite token payload
     */
    async verifyInviteToken(token: string): Promise<InviteTokenPayload> {
        const payload = await this.verifyToken<InviteTokenPayload>(token, this.inviteSecret, AuthTokenType.INVITE);

        if (
            typeof payload.sub !== 'string' ||
            payload.sub.length === 0 ||
            typeof payload.jti !== 'string' ||
            !UUID_V4_PATTERN.test(payload.jti) ||
            !Number.isSafeInteger(payload.exp) ||
            payload.exp <= 0 ||
            !Number.isSafeInteger(payload.inviteRevocationVersion) ||
            payload.inviteRevocationVersion < 0
        ) {
            throw new UnauthenticatedException();
        }

        return payload;
    }

    /**
     * Verifies the signature, expiry, discriminator, and persisted-request claim shape.
     *
     * @param token The JWT email confirmation token string
     * @returns Verified email confirmation claims
     */
    async verifyEmailConfirmationToken(token: string): Promise<EmailConfirmationTokenPayload> {
        const payload = await this.verifyToken<EmailConfirmationTokenPayload>(
            token,
            this.emailConfirmationSecret,
            AuthTokenType.EMAIL_CONFIRM,
        );

        if (
            typeof payload.sub !== 'string' ||
            payload.sub.length === 0 ||
            !PRINCIPAL_TYPES.has(payload.principalType) ||
            typeof payload.jti !== 'string' ||
            !UUID_V4_PATTERN.test(payload.jti) ||
            !Number.isSafeInteger(payload.exp) ||
            payload.exp <= 0 ||
            !Number.isSafeInteger(payload.emailRevocationVersion) ||
            payload.emailRevocationVersion < 0
        ) {
            throw new UnauthenticatedException();
        }

        return payload;
    }

    /**
     * Verifies a token against its shared per-type secret and validates its discriminator.
     *
     * @param token The JWT token string
     * @param secret The per-type signing secret to validate the signature
     * @param expectedType The type this verification method is responsible for
     * @param ignoreExpiration Allow credential expiry only for session closure.
     * @returns The decoded token payload
     */
    private async verifyToken<T extends { readonly type: AuthTokenType }>(
        token: string,
        secret: string,
        expectedType: AuthTokenType,
        ignoreExpiration = false,
    ): Promise<T> {
        try {
            const payload = await this.jwtService.verifyAsync<T>(token, {
                secret,
                algorithms: ['HS256'],
                ignoreExpiration,
            });

            this.assertTokenType(payload.type, expectedType);

            return payload;
        } catch (error) {
            if (error instanceof JsonWebTokenError) {
                throw new UnauthenticatedException(UnauthenticatedMessage.DEFAULT, {
                    cause: error,
                });
            }

            throw error;
        }
    }

    /**
     * Rejects a verified token whose type discriminator names another token type. Separate secrets
     * already isolate the types; this backstop is what still holds if two secrets are ever
     * misconfigured to the same value.
     *
     * @param actual The type discriminator carried by the verified payload
     * @param expected The type the calling verify method promises
     * @throws {Error} When the two do not match.
     */
    private assertTokenType(actual: AuthTokenType, expected: AuthTokenType) {
        if (actual !== expected) {
            throw new UnauthenticatedException(`Token type mismatch: expected '${expected}'.`);
        }
    }

    /**
     * Rejects legacy or malformed session claims before using them as store keys or authorization data.
     * @param payload Signature-verified session claims.
     */
    private assertSessionClaims(payload: AccessTokenPayload | RefreshTokenPayload) {
        if (
            typeof payload.sub !== 'string' ||
            payload.sub.length === 0 ||
            typeof payload.sid !== 'string' ||
            !UUID_V4_PATTERN.test(payload.sid) ||
            !PRINCIPAL_TYPES.has(payload.principalType) ||
            !Number.isSafeInteger(payload.sessionVersion) ||
            payload.sessionVersion < 0 ||
            !Number.isSafeInteger(payload.sessionExpiresAt) ||
            payload.sessionExpiresAt <= Math.floor(Date.now() / 1000) ||
            !Number.isSafeInteger(payload.exp) ||
            payload.exp <= 0 ||
            payload.exp > payload.sessionExpiresAt
        ) {
            throw new UnauthenticatedException();
        }
    }

    /**
     * Rejects missing credential identifiers before rotation or logout.
     * @param jti Verified refresh identifier.
     */
    private assertRefreshJti(jti: string) {
        if (typeof jti !== 'string' || !UUID_V4_PATTERN.test(jti)) {
            throw new UnauthenticatedException();
        }
    }
}
