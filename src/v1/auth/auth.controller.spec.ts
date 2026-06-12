import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthTokenType } from 'src/common/enum/auth/auth-token-type.enum';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import type { AccessTokenPayload } from 'src/common/guard/interface/auth.interface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GetAuthTokensDto } from './dto/get-auth-tokens.dto';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { PostAuthRefreshDto } from './dto/post-auth-refresh.dto';

describe('AuthController', () => {
    const mockAuthService = {
        loginUser: vi.fn(),
        loginAdmin: vi.fn(),
        refresh: vi.fn(),
        logout: vi.fn(),
        logoutAll: vi.fn(),
        ban: vi.fn(),
        unban: vi.fn(),
    } satisfies Record<keyof AuthService, unknown>;

    let controller: AuthController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [{ provide: AuthService, useValue: mockAuthService }],
        }).compile();

        controller = module.get(AuthController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('loginUser', () => {
        const loginDto: PostAuthLoginDto = { email: 'user@example.com', password: 'Password123!' };

        it('should successfully login user and return GetAuthTokensDto', async () => {
            const tokensDto: GetAuthTokensDto = {
                accessToken: 'user-access-token',
                refreshToken: 'user-refresh-token',
            };

            mockAuthService.loginUser.mockResolvedValueOnce(tokensDto);

            const result = await controller.loginUser(loginDto);

            expect(result).toBeInstanceOf(GetAuthTokensDto);
            expect(result.accessToken).toBe(tokensDto.accessToken);
            expect(result.refreshToken).toBe(tokensDto.refreshToken);
            expect(mockAuthService.loginUser).toHaveBeenCalledWith(loginDto);
        });

        it('should propagate errors from authService', async () => {
            mockAuthService.loginUser.mockRejectedValueOnce(new UnauthorizedException());

            await expect(controller.loginUser(loginDto)).rejects.toThrow(UnauthorizedException);
            expect(mockAuthService.loginUser).toHaveBeenCalledWith(loginDto);
        });
    });

    describe('loginAdmin', () => {
        const loginDto: PostAuthLoginDto = { email: 'admin@example.com', password: 'Password123!' };

        it('should successfully login admin and return GetAuthTokensDto', async () => {
            const tokensDto: GetAuthTokensDto = {
                accessToken: 'admin-access-token',
                refreshToken: 'admin-refresh-token',
            };

            mockAuthService.loginAdmin.mockResolvedValueOnce(tokensDto);

            const result = await controller.loginAdmin(loginDto);

            expect(result).toBeInstanceOf(GetAuthTokensDto);
            expect(result.accessToken).toBe(tokensDto.accessToken);
            expect(result.refreshToken).toBe(tokensDto.refreshToken);
            expect(mockAuthService.loginAdmin).toHaveBeenCalledWith(loginDto);
        });

        it('should propagate errors from authService', async () => {
            mockAuthService.loginAdmin.mockRejectedValueOnce(new UnauthorizedException());

            await expect(controller.loginAdmin(loginDto)).rejects.toThrow(UnauthorizedException);
            expect(mockAuthService.loginAdmin).toHaveBeenCalledWith(loginDto);
        });
    });

    describe('refresh', () => {
        const refreshDto: PostAuthRefreshDto = { refreshToken: 'valid-refresh-token' };

        it('should successfully rotate tokens and return GetAuthTokensDto', async () => {
            const tokensDto: GetAuthTokensDto = {
                accessToken: 'rotated-access-token',
                refreshToken: 'rotated-refresh-token',
            };

            mockAuthService.refresh.mockResolvedValueOnce(tokensDto);

            const result = await controller.refresh(refreshDto);

            expect(result).toBeInstanceOf(GetAuthTokensDto);
            expect(result.accessToken).toBe(tokensDto.accessToken);
            expect(result.refreshToken).toBe(tokensDto.refreshToken);
            expect(mockAuthService.refresh).toHaveBeenCalledWith(refreshDto);
        });

        it('should propagate errors from authService', async () => {
            mockAuthService.refresh.mockRejectedValueOnce(new UnauthorizedException());

            await expect(controller.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
            expect(mockAuthService.refresh).toHaveBeenCalledWith(refreshDto);
        });
    });

    describe('logout', () => {
        const refreshDto: PostAuthRefreshDto = { refreshToken: 'valid-refresh-token' };

        it('should successfully invoke logout on service and return undefined', async () => {
            mockAuthService.logout.mockResolvedValueOnce(undefined);

            await expect(controller.logout(refreshDto)).resolves.toBeUndefined();
            expect(mockAuthService.logout).toHaveBeenCalledWith(refreshDto);
        });

        it('should propagate errors from authService', async () => {
            mockAuthService.logout.mockRejectedValueOnce(new Error());

            await expect(controller.logout(refreshDto)).rejects.toThrow(Error);
            expect(mockAuthService.logout).toHaveBeenCalledWith(refreshDto);
        });
    });

    describe('logoutAll', () => {
        const payload: AccessTokenPayload = {
            sub: 'user-id',
            role: AuthUserRole.USER,
            type: AuthTokenType.ACCESS,
        };

        it('should successfully invoke logoutAll and ban on service and return undefined', async () => {
            mockAuthService.logoutAll.mockResolvedValueOnce(undefined);
            mockAuthService.ban.mockResolvedValueOnce(undefined);

            await expect(controller.logoutAll(payload)).resolves.toBeUndefined();
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(payload.role, payload.sub);
            expect(mockAuthService.ban).toHaveBeenCalledWith(payload.role, payload.sub);
        });

        it('should propagate errors from authService', async () => {
            mockAuthService.logoutAll.mockRejectedValueOnce(new Error());

            await expect(controller.logoutAll(payload)).rejects.toThrow(Error);
            expect(mockAuthService.logoutAll).toHaveBeenCalledWith(payload.role, payload.sub);
        });
    });
});
