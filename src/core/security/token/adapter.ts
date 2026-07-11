/**
 * @file token.service.ts
 * @description Service responsible for generating and verifying JWT tokens.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { ENV } from 'src/core/config';
import { AuthTokenType } from 'src/core/security/auth/enum/auth-token-type.enum';
import type { AccessTokenPayload } from 'src/core/security/auth/type/access-token-payload.type';
import type { AuthRole } from 'src/core/security/auth/type/auth-role.type';
import type { RefreshTokenPayload } from 'src/core/security/auth/type/refresh-token-payload.type';
import type { ITokenPort } from 'src/core/security/token/port';

/**
 * Service responsible for generating, signing, and verifying JWT access and refresh tokens.
 */
@Injectable()
export class TokenAdapter implements ITokenPort {
    /**
     * Creates an instance of TokenService.
     *
     * @param jwtService JWT utility service.
     * @param configService Configuration reader service.
     */
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Generates a signed JWT access token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving to the generated access token.
     */
    async generateAccessToken(role: AuthRole, id: string): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, role, type: AuthTokenType.ACCESS },
            {
                secret: this.configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET),
                expiresIn: this.configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL) as NonNullable<
                    JwtSignOptions['expiresIn']
                >,
            },
        );
    }

    /**
     * Generates a signed JWT refresh token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique refresh token identifier.
     * @returns A promise resolving to the generated refresh token.
     */
    async generateRefreshToken(role: AuthRole, id: string, jti: string): Promise<string> {
        return this.jwtService.signAsync(
            { sub: id, role, jti, type: AuthTokenType.REFRESH },
            {
                secret: this.configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET),
                expiresIn: this.configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL) as NonNullable<
                    JwtSignOptions['expiresIn']
                >,
            },
        );
    }

    /**
     * Generates a pair of JWT access and refresh tokens.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns Object containing the generated access token, refresh token, and JTI.
     */
    async generateTokens(
        role: AuthRole,
        id: string,
    ): Promise<{ accessToken: string; refreshToken: string; jti: string }> {
        const jti = crypto.randomUUID();

        return Promise.all([this.generateAccessToken(role, id), this.generateRefreshToken(role, id, jti)]).then(
            ([accessToken, refreshToken]) => ({ accessToken, refreshToken, jti }),
        );
    }

    /**
     * Verifies an access token.
     *
     * @param token The JWT access token string.
     * @returns The parsed access token payload.
     */
    async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
        return this.jwtService.verifyAsync<AccessTokenPayload>(token, {
            secret: this.configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET),
        });
    }

    /**
     * Verifies a refresh token.
     *
     * @param token The JWT refresh token string.
     * @returns The parsed refresh token payload.
     */
    async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
        return this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
            secret: this.configService.getOrThrow<string>(ENV.JWT_REFRESH_SECRET),
        });
    }
}
