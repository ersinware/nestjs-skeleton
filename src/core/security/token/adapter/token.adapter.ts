/**
 * @file token.adapter.ts
 * @description JWT-backed adapter implementing the token port.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { JsonWebTokenError } from 'jsonwebtoken';
import { ENV } from 'src/core/config';
import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { InviteTokenPayload } from 'src/core/security/token/invite-token-payload.type';
import type { GeneratedTokens, ITokenPort } from 'src/core/security/token/port/token.port';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import type { Principal } from 'src/shared/domain/principal';
import { UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Implements {@link ITokenPort} with signed JWTs, using separate secrets and lifetimes
 * per token type so a leaked access secret cannot forge refresh tokens.
 */
@Injectable()
export class TokenAdapter implements ITokenPort {
    /** Access token lifetime, read once at boot — config is immutable after validation. */
    private readonly accessTtl: NonNullable<JwtSignOptions['expiresIn']>;

    /** Refresh token lifetime, read once at boot — config is immutable after validation. */
    private readonly refreshTtl: NonNullable<JwtSignOptions['expiresIn']>;

    /** Access token signing secret, read once at boot — config is immutable after validation. */
    private readonly accessSecret: string;

    /** Refresh token signing secret, read once at boot — config is immutable after validation. */
    private readonly refreshSecret: string;

    /** Invite token lifetime, read once at boot — config is immutable after validation. */
    private readonly inviteTtl: NonNullable<JwtSignOptions['expiresIn']>;

    /** Invite token signing secret, read once at boot — config is immutable after validation. */
    private readonly inviteSecret: string;

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
        this.accessTtl = configService.getOrThrow<NonNullable<JwtSignOptions['expiresIn']>>(ENV.JWT_ACCESS_TTL);
        this.refreshTtl = configService.getOrThrow<NonNullable<JwtSignOptions['expiresIn']>>(ENV.JWT_REFRESH_TTL);
        this.accessSecret = configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
        this.refreshSecret = configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET);
        this.inviteTtl = configService.getOrThrow<NonNullable<JwtSignOptions['expiresIn']>>(ENV.JWT_INVITE_TTL);
        this.inviteSecret = configService.getOrThrow<string>(ENV.JWT_INVITE_SECRET);
    }

    /**
     * Generates a signed access/refresh token pair, minting the refresh token's JTI.
     *
     * @param principal The verified principal, embedded as the subject and kind of both tokens; its permissions go into the access token only
     * @param sessionVersion The session version to stamp into both tokens
     * @returns The signed token pair and the refresh token's JTI
     */
    async generateTokens(principal: Principal, sessionVersion: number): Promise<GeneratedTokens> {
        const refreshTokenJti = crypto.randomUUID();

        return Promise.all([
            this.generateAccessToken(principal, sessionVersion),
            this.generateRefreshToken(principal, refreshTokenJti, sessionVersion),
        ]).then(([accessToken, refreshToken]) => ({ accessToken, refreshToken, refreshTokenJti }));
    }

    /**
     * Signs an access token carrying the principal, its kind, its permissions, and the session version.
     *
     * @param principal The verified principal the token is minted for
     * @param sessionVersion The session version the token is minted at
     * @returns The signed access token
     */
    private async generateAccessToken(principal: Principal, sessionVersion: number): Promise<string> {
        return this.jwtService.signAsync(
            {
                sub: principal.id,
                principalType: principal.type,
                permissions: principal.permissions,
                sessionVersion,
                type: AuthTokenType.ACCESS,
            },
            {
                secret: this.accessSecret,
                expiresIn: this.accessTtl,
            },
        );
    }

    /**
     * Signs a refresh token carrying the principal, its kind, the session version, and the JTI that
     * session storage tracks for rotation and reuse detection. No permissions: a refresh re-reads them.
     *
     * @param principal The verified principal the token is minted for
     * @param jti The unique token identifier session storage tracks
     * @param sessionVersion The session version the token is minted at
     * @returns The signed refresh token
     */
    private async generateRefreshToken(principal: Principal, jti: string, sessionVersion: number): Promise<string> {
        return this.jwtService.signAsync(
            { sub: principal.id, principalType: principal.type, jti, sessionVersion, type: AuthTokenType.REFRESH },
            {
                secret: this.refreshSecret,
                expiresIn: this.refreshTtl,
            },
        );
    }

    /**
     * Signs an invite token carrying only the pending account's identifier.
     *
     * @param id The identifier of the account the invitation activates, embedded as the subject
     * @returns The signed invite token
     */
    async generateInviteToken(id: string): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, type: AuthTokenType.INVITE },
            {
                secret: this.inviteSecret,
                expiresIn: this.inviteTtl,
            },
        );
    }

    /**
     * Verifies an access token's signature, expiry, and type.
     *
     * @param token The JWT access token string
     * @returns The decoded access token payload
     */
    async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
        return this.verifyToken<AccessTokenPayload>(token, this.accessSecret, AuthTokenType.ACCESS);
    }

    /**
     * Verifies a refresh token's signature, expiry, and type.
     *
     * @param token The JWT refresh token string
     * @returns The decoded refresh token payload
     */
    async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
        return this.verifyToken<RefreshTokenPayload>(token, this.refreshSecret, AuthTokenType.REFRESH);
    }

    /**
     * Verifies an invite token's signature, expiry, and type.
     *
     * @param token The JWT invite token string
     * @returns The decoded invite token payload
     */
    async verifyInviteToken(token: string): Promise<InviteTokenPayload> {
        return this.verifyToken<InviteTokenPayload>(token, this.inviteSecret, AuthTokenType.INVITE);
    }

    /**
     * Verifies a token against its shared per-type secret and validates its discriminator.
     *
     * @param token The JWT token string
     * @param secret The per-type signing secret to validate the signature
     * @param expectedType The type this verification method is responsible for
     * @returns The decoded token payload
     */
    private async verifyToken<T extends { type: AuthTokenType }>(
        token: string,
        secret: string,
        expectedType: AuthTokenType,
    ): Promise<T> {
        try {
            const payload = await this.jwtService.verifyAsync<T>(token, { secret });

            this.assertTokenType(payload.type, expectedType);

            return payload;
        } catch (error) {
            if (error instanceof JsonWebTokenError) {
                throw new UnauthenticatedException(UnauthenticatedMessage.DEFAULT, {
                    cause: this.toError(error),
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
     * Normalizes unknown throw values into a real Error instance for nested-cause compatibility.
     *
     * @param error A value caught from an external library
     * @returns A concrete Error object for {@link ErrorOptions.cause}
     */
    private toError(error: unknown): Error {
        if (error instanceof Error) return error;

        return new Error(typeof error === 'string' ? error : 'Token validation failed');
    }
}
