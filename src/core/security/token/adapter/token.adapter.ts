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

    /**
     * @param jwtService Signs and verifies JWTs.
     * @param configService Provides the per-type secrets and lifetimes.
     */
    constructor(
        private readonly jwtService: JwtService,
        configService: ConfigService,
    ) {
        this.accessTtl = configService.getOrThrow<NonNullable<JwtSignOptions['expiresIn']>>(ENV.JWT_ACCESS_TTL);
        this.refreshTtl = configService.getOrThrow<NonNullable<JwtSignOptions['expiresIn']>>(ENV.JWT_REFRESH_TTL);
        this.accessSecret = configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
        this.refreshSecret = configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET);
    }

    /**
     * Generates a signed access/refresh token pair, minting the refresh token's JTI.
     */
    async generateTokens(role: AuthRole, id: string, version: number): Promise<GeneratedTokens> {
        const refreshTokenJti = crypto.randomUUID();

        return Promise.all([
            this.generateAccessToken(role, id, version),
            this.generateRefreshToken(role, id, refreshTokenJti, version),
        ]).then(([accessToken, refreshToken]) => ({ accessToken, refreshToken, refreshTokenJti }));
    }

    /**
     * Verifies an access token's signature and expiry.
     */
    async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
        return this.jwtService.verifyAsync<AccessTokenPayload>(token, {
            secret: this.accessSecret,
        });
    }

    /**
     * Verifies a refresh token's signature and expiry.
     */
    async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
        return this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
            secret: this.refreshSecret,
        });
    }

    /**
     * Signs an access token carrying the principal, role, and session version.
     */
    private async generateAccessToken(role: AuthRole, id: string, version: number): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, role, version, type: AuthTokenType.ACCESS },
            {
                secret: this.accessSecret,
                expiresIn: this.accessTtl,
            },
        );
    }

    /**
     * Signs a refresh token carrying the principal, role, session version, and the JTI
     * that session storage tracks for rotation and reuse detection.
     */
    private async generateRefreshToken(role: AuthRole, id: string, jti: string, version: number): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, role, jti, version, type: AuthTokenType.REFRESH },
            {
                secret: this.refreshSecret,
                expiresIn: this.refreshTtl,
            },
        );
    }
}
