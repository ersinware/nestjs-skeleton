/**
 * @file token.adapter.ts
 * @description JWT-backed adapter implementing the token port.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { ENV } from 'src/core/config';
import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { InviteTokenPayload } from 'src/core/security/token/invite-token-payload.type';
import type { GeneratedTokens, ITokenPort } from 'src/core/security/token/port/token.port';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import type { AuthRole } from 'src/shared/domain/auth-role';

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
     * @param role The principal's authentication role, embedded into both tokens
     * @param id The principal identifier, embedded as the subject of both tokens
     * @param sessionVersion The session version to stamp into both tokens
     * @returns The signed token pair and the refresh token's JTI
     */
    async generateTokens(role: AuthRole, id: string, sessionVersion: number): Promise<GeneratedTokens> {
        const refreshTokenJti = crypto.randomUUID();

        return Promise.all([
            this.generateAccessToken(role, id, sessionVersion),
            this.generateRefreshToken(role, id, refreshTokenJti, sessionVersion),
        ]).then(([accessToken, refreshToken]) => ({ accessToken, refreshToken, refreshTokenJti }));
    }

    /**
     * Signs an access token carrying the principal, role, and session version.
     *
     * @param role The principal's authentication role
     * @param id The principal identifier, embedded as the subject
     * @param sessionVersion The session version the token is minted at
     * @returns The signed access token
     */
    private async generateAccessToken(role: AuthRole, id: string, sessionVersion: number): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, role, sessionVersion, type: AuthTokenType.ACCESS },
            {
                secret: this.accessSecret,
                expiresIn: this.accessTtl,
            },
        );
    }

    /**
     * Signs a refresh token carrying the principal, role, session version, and the JTI
     * that session storage tracks for rotation and reuse detection.
     *
     * @param role The principal's authentication role
     * @param id The principal identifier, embedded as the subject
     * @param jti The unique token identifier session storage tracks
     * @param sessionVersion The session version the token is minted at
     * @returns The signed refresh token
     */
    private async generateRefreshToken(
        role: AuthRole,
        id: string,
        jti: string,
        sessionVersion: number,
    ): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, role, jti, sessionVersion, type: AuthTokenType.REFRESH },
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
        const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
            secret: this.accessSecret,
        });

        this.assertTokenType(payload.type, AuthTokenType.ACCESS);

        return payload;
    }

    /**
     * Verifies a refresh token's signature, expiry, and type.
     *
     * @param token The JWT refresh token string
     * @returns The decoded refresh token payload
     */
    async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
        const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
            secret: this.refreshSecret,
        });

        this.assertTokenType(payload.type, AuthTokenType.REFRESH);

        return payload;
    }

    /**
     * Verifies an invite token's signature, expiry, and type.
     *
     * @param token The JWT invite token string
     * @returns The decoded invite token payload
     */
    async verifyInviteToken(token: string): Promise<InviteTokenPayload> {
        const payload = await this.jwtService.verifyAsync<InviteTokenPayload>(token, {
            secret: this.inviteSecret,
        });

        this.assertTokenType(payload.type, AuthTokenType.INVITE);

        return payload;
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
            throw new Error(`Token type mismatch: expected '${expected}'.`);
        }
    }
}
