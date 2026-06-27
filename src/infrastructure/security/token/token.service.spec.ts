/**
 * @file token.service.spec.ts
 * @description Unit tests for the JWT token operations service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenService } from './token.service';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { AuthTokenType } from 'src/common/auth/enum/auth-token-type.enum';
import { ENV } from 'src/common/config/constant/env.constant';
import { AccessTokenPayload } from 'src/common/auth/interface/access-token-payload.interface';
import { RefreshTokenPayload } from 'src/common/auth/interface/refresh-token-payload.interface';

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

    let service: TokenService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TokenService,
                { provide: JwtService, useValue: mockJwtService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get(TokenService);

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
            const role = AuthUserRole.USER,
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

        it('should generate a signed JWT access token with custom TTL when provided', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                accessToken = 'access-token',
                customTtl = '1h';

            mockJwtService.signAsync.mockResolvedValueOnce(accessToken);

            const result = await service.generateAccessToken(role, id, customTtl);

            expect(result).toBe(accessToken);
            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                { sub: id, role, type: AuthTokenType.ACCESS },
                { secret: JWT_ACCESS_SECRET, expiresIn: customTtl },
            );
        });
    });

    describe('generateRefreshToken', () => {
        it('should generate a signed JWT refresh token with default TTL', async () => {
            const role = AuthUserRole.USER,
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

        it('should generate a signed JWT refresh token with custom TTL when provided', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                jti = '00000000-0000-0000-0000-000000000000',
                refreshToken = 'refresh-token',
                customTtl = '30d';

            mockJwtService.signAsync.mockResolvedValueOnce(refreshToken);

            const result = await service.generateRefreshToken(role, id, jti, customTtl);

            expect(result).toBe(refreshToken);
            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                { sub: id, role, jti, type: AuthTokenType.REFRESH },
                { secret: JWT_REFRESH_SECRET, expiresIn: customTtl },
            );
        });
    });

    describe('generateTokens', () => {
        it('should generate a pair of JWT access and refresh tokens with correct payload and options', async () => {
            const role = AuthUserRole.USER,
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
                    role: AuthUserRole.USER,
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
                    role: AuthUserRole.USER,
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
