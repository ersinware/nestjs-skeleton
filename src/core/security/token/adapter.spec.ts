/**
 * @file token.service.spec.ts
 * @description Unit tests for the JWT token operations service.
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { ENV } from 'src/core/config';
import { AuthTokenType } from 'src/core/security/auth/enum/auth-token-type.enum';
import type { AccessTokenPayload } from 'src/core/security/auth/type/access-token-payload.type';
import type { RefreshTokenPayload } from 'src/core/security/auth/type/refresh-token-payload.type';
import { TokenAdapter } from 'src/core/security/token/adapter';
import { UserRole } from 'src/shared/domain/user';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('crypto', () => ({
    randomUUID: vi.fn(),
}));

describe('TokenService', () => {
    const mockJwtService = {
            signAsync: vi.fn(),
            verifyAsync: vi.fn(),
        },
        mockConfigService = {
            getOrThrow: vi.fn(),
        },
        JWT_ACCESS_SECRET = 'access-secret',
        JWT_REFRESH_SECRET = 'refresh-secret',
        JWT_ACCESS_TTL = '15m',
        JWT_REFRESH_TTL = '7d';

    let service: TokenAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TokenAdapter,
                { provide: JwtService, useValue: mockJwtService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get(TokenAdapter);

        mockConfigService.getOrThrow.mockImplementation((key: string) => {
            switch (key) {
                case ENV.JWT_ACCESS_SECRET:
                    return JWT_ACCESS_SECRET;
                case ENV.JWT_ACCESS_TTL:
                    return JWT_ACCESS_TTL;
                case ENV.JWT_REFRESH_SECRET:
                    return JWT_REFRESH_SECRET;
                case ENV.JWT_REFRESH_TTL:
                    return JWT_REFRESH_TTL;
                default:
                    throw new Error(`Unexpected config key: ${key}`);
            }
        });
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('generateAccessToken', () => {
        it('should generate a signed JWT access token with default TTL', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                accessToken = 'access-token';

            mockJwtService.signAsync.mockResolvedValueOnce(accessToken);

            const result = await service.generateAccessToken(role, id);

            expect(result).toBe(accessToken);
            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                { sub: id, role, type: AuthTokenType.ACCESS },
                { secret: JWT_ACCESS_SECRET, expiresIn: JWT_ACCESS_TTL },
            );
        });
    });

    describe('generateRefreshToken', () => {
        it('should generate a signed JWT refresh token with default TTL', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                jti = '00000000-0000-0000-0000-000000000000',
                refreshToken = 'refresh-token';

            mockJwtService.signAsync.mockResolvedValueOnce(refreshToken);

            const result = await service.generateRefreshToken(role, id, jti);

            expect(result).toBe(refreshToken);
            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                { sub: id, role, jti, type: AuthTokenType.REFRESH },
                { secret: JWT_REFRESH_SECRET, expiresIn: JWT_REFRESH_TTL },
            );
        });
    });

    describe('generateTokens', () => {
        it('should generate a pair of JWT access and refresh tokens with correct payload and options', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                jti = '00000000-0000-0000-0000-000000000000',
                accessToken = 'access-token',
                refreshToken = 'refresh-token';

            vi.mocked(crypto.randomUUID).mockReturnValueOnce(jti);
            mockJwtService.signAsync.mockResolvedValueOnce(accessToken).mockResolvedValueOnce(refreshToken);

            const result = await service.generateTokens(role, id);

            expect(result).toEqual({ accessToken, refreshToken, jti });
            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                { sub: id, role, type: AuthTokenType.ACCESS },
                { secret: JWT_ACCESS_SECRET, expiresIn: JWT_ACCESS_TTL },
            );
            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                { sub: id, role, jti, type: AuthTokenType.REFRESH },
                { secret: JWT_REFRESH_SECRET, expiresIn: JWT_REFRESH_TTL },
            );
        });
    });

    describe('verifyAccessToken', () => {
        it('should verify an access token and return the payload', async () => {
            const token = 'valid-token',
                payload: AccessTokenPayload = {
                    sub: 'user-id',
                    role: UserRole.USER,
                    type: AuthTokenType.ACCESS,
                };

            mockJwtService.verifyAsync.mockResolvedValueOnce(payload);

            await expect(service.verifyAccessToken(token)).resolves.toEqual(payload);
            expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(token, { secret: JWT_ACCESS_SECRET });
        });

        it('should throw an error if verification fails', async () => {
            const token = 'invalid-token';

            mockJwtService.verifyAsync.mockRejectedValueOnce(new Error());

            await expect(service.verifyAccessToken(token)).rejects.toThrow();
            expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(token, { secret: JWT_ACCESS_SECRET });
        });
    });

    describe('verifyRefreshToken', () => {
        it('should verify a refresh token and return the payload', async () => {
            const token = 'valid-token',
                payload: RefreshTokenPayload = {
                    sub: 'user-id',
                    role: UserRole.USER,
                    jti: 'some-jti',
                    type: AuthTokenType.REFRESH,
                };

            mockJwtService.verifyAsync.mockResolvedValueOnce(payload);

            await expect(service.verifyRefreshToken(token)).resolves.toEqual(payload);
            expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(token, { secret: JWT_REFRESH_SECRET });
        });

        it('should throw an error if verification fails', async () => {
            const token = 'invalid-token';

            mockJwtService.verifyAsync.mockRejectedValueOnce(new Error());

            await expect(service.verifyRefreshToken(token)).rejects.toThrow();
            expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(token, { secret: JWT_REFRESH_SECRET });
        });
    });
});
