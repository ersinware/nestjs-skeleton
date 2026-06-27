/**
 * @file auth.guard.spec.ts
 * @description Unit tests for the AuthGuard covering all execution paths.
 */

import { ExecutionContext, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_CACHE_STATE_SERVICE } from 'src/common/port/cache/cache.constant';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_DECORATOR_PUBLIC } from 'src/common/auth/decorator/public.decorator';
import { AuthGuard } from './auth.guard';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { TOKEN_TOKEN_SERVICE } from 'src/common/port/security/token.constant';

describe('AuthGuard', () => {
    const mockReflector = { getAllAndOverride: vi.fn() },
        mockTokenService = { verifyAccessToken: vi.fn() },
        mockCacheStateService = { isBanned: vi.fn() };

    let guard: AuthGuard;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthGuard,
                { provide: Reflector, useValue: mockReflector },
                { provide: TOKEN_TOKEN_SERVICE, useValue: mockTokenService },
                { provide: TOKEN_CACHE_STATE_SERVICE, useValue: mockCacheStateService },
            ],
        }).compile();

        guard = module.get<AuthGuard>(AuthGuard);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    describe('canActivate', () => {
        /**
         * Helper function to build a mock ExecutionContext.
         *
         * @param options Context configuration options.
         * @param options.isPublic Whether the route is marked as public.
         * @param options.authorization Value of the authorization header.
         * @param options.handler Mock handler for Reflector target.
         * @param options.klass Mock class for Reflector target.
         * @returns Mocked NestJS ExecutionContext.
         */
        function createMockContext(
            options: {
                isPublic?: boolean | undefined;
                authorization?: string | undefined;
                handler?: object | undefined;
                klass?: object | undefined;
            } = {},
        ): ExecutionContext {
            mockReflector.getAllAndOverride.mockImplementation((key: string) =>
                key === KEY_DECORATOR_PUBLIC ? options.isPublic : undefined,
            );

            return {
                getHandler: vi.fn().mockReturnValue(options.handler ?? {}),
                getClass: vi.fn().mockReturnValue(options.klass ?? {}),
                switchToHttp: vi.fn().mockReturnValue({
                    getRequest: vi.fn().mockReturnValue({
                        headers: {
                            authorization: options.authorization,
                        },
                    }),
                }),
            } as unknown as ExecutionContext;
        }

        it('should return true immediately for routes decorated with @Public()', async () => {
            await expect(guard.canActivate(createMockContext({ isPublic: true }))).resolves.toBe(true);
            expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if authorization header is missing', async () => {
            await expect(guard.canActivate(createMockContext({ authorization: undefined }))).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if authorization type is not Bearer', async () => {
            await expect(
                guard.canActivate(createMockContext({ authorization: 'Basic some-credentials' })),
            ).rejects.toThrow(UnauthorizedException);
            expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if authorization header is "Bearer" with no token', async () => {
            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer ' }))).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if authorization header is "Bearer" with no trailing space or token', async () => {
            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer' }))).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if JWT verification fails', async () => {
            mockTokenService.verifyAccessToken.mockRejectedValue(new Error());
            await expect(
                guard.canActivate(createMockContext({ authorization: 'Bearer invalid.token' })),
            ).rejects.toThrow(UnauthorizedException);
            expect(mockTokenService.verifyAccessToken).toHaveBeenCalledWith('invalid.token');
            expect(mockCacheStateService.isBanned).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if user is found in the blocklist cache', async () => {
            const payload = {
                role: AuthUserRole.USER,
                sub: '018f43c3-6bb3-7d72-911e-848821a837c3',
            };

            mockTokenService.verifyAccessToken.mockResolvedValue(payload);
            mockCacheStateService.isBanned.mockResolvedValue(true);

            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer valid.token' }))).rejects.toThrow(
                UnauthorizedException,
            );
            expect(mockTokenService.verifyAccessToken).toHaveBeenCalledWith('valid.token');
            expect(mockCacheStateService.isBanned).toHaveBeenCalledWith(payload.role, payload.sub);
        });

        it('should throw InternalServerErrorException if cache service throws a non-unauthorized error', async () => {
            const payload = {
                role: AuthUserRole.USER,
                sub: '018f43c3-6bb3-7d72-911e-848821a837c3',
            };

            mockTokenService.verifyAccessToken.mockResolvedValue(payload);
            mockCacheStateService.isBanned.mockRejectedValueOnce(new Error());

            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer valid.token' }))).rejects.toThrow(
                InternalServerErrorException,
            );
            expect(mockTokenService.verifyAccessToken).toHaveBeenCalledWith('valid.token');
            expect(mockCacheStateService.isBanned).toHaveBeenCalledWith(payload.role, payload.sub);
        });

        it('should return true and attach payload to request when token is valid and user is not blocklisted', async () => {
            const payload = { sub: '018f43c3-6bb3-7d72-911e-848821a837c3', role: AuthUserRole.USER };

            mockTokenService.verifyAccessToken.mockResolvedValue(payload);
            mockCacheStateService.isBanned.mockResolvedValue(false);

            const context = createMockContext({ authorization: 'Bearer valid.token' });

            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(mockTokenService.verifyAccessToken).toHaveBeenCalledWith('valid.token');
            expect(mockCacheStateService.isBanned).toHaveBeenCalledWith(payload.role, payload.sub);
            expect(context.switchToHttp().getRequest<Record<string, unknown>>()['accessTokenPayload']).toEqual(payload);
        });
    });
});
