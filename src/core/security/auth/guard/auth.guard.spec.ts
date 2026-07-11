/**
 * @file auth.guard.spec.ts
 * @description Unit tests for the AuthGuard covering all execution paths.
 */

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { SystemException, UnauthenticatedException } from 'src/core/exception';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import { AuthGuard } from 'src/core/security/auth/guard/auth.guard';
import { TOKEN_SESSION_PORT } from 'src/core/security/session/port';
import { TOKEN_TOKEN_PORT } from 'src/core/security/token';
import { UserRole } from 'src/shared/domain/user';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuthGuard', () => {
    const mockReflector = { getAllAndOverride: vi.fn() },
        mockTokenPort = { verifyAccessToken: vi.fn() },
        mockSessionPort = { isBanned: vi.fn() };

    let guard: AuthGuard;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthGuard,
                { provide: Reflector, useValue: mockReflector },
                { provide: TOKEN_TOKEN_PORT, useValue: mockTokenPort },
                { provide: TOKEN_SESSION_PORT, useValue: mockSessionPort },
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
            expect(mockTokenPort.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthenticatedException if authorization header is missing', async () => {
            await expect(guard.canActivate(createMockContext({ authorization: undefined }))).rejects.toThrow();
            expect(mockTokenPort.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthenticatedException if authorization type is not Bearer', async () => {
            await expect(
                guard.canActivate(createMockContext({ authorization: 'Basic some-credentials' })),
            ).rejects.toThrow(UnauthenticatedException);
            expect(mockTokenPort.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthenticatedException if authorization header is "Bearer" with no token', async () => {
            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer ' }))).rejects.toThrow();
            expect(mockTokenPort.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthenticatedException if authorization header is "Bearer" with no trailing space or token', async () => {
            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer' }))).rejects.toThrow();
            expect(mockTokenPort.verifyAccessToken).not.toHaveBeenCalled();
        });

        it('should throw UnauthenticatedException if JWT verification fails', async () => {
            mockTokenPort.verifyAccessToken.mockRejectedValue(new Error());
            await expect(
                guard.canActivate(createMockContext({ authorization: 'Bearer invalid.token' })),
            ).rejects.toThrow(UnauthenticatedException);
            expect(mockTokenPort.verifyAccessToken).toHaveBeenCalledWith('invalid.token');
            expect(mockSessionPort.isBanned).not.toHaveBeenCalled();
        });

        it('should throw UnauthenticatedException if user is found in the blocklist cache', async () => {
            const payload = {
                role: UserRole.USER,
                sub: '018f43c3-6bb3-7d72-911e-848821a837c3',
            };

            mockTokenPort.verifyAccessToken.mockResolvedValue(payload);
            mockSessionPort.isBanned.mockResolvedValue(true);

            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer valid.token' }))).rejects.toThrow(
                UnauthenticatedException,
            );
            expect(mockTokenPort.verifyAccessToken).toHaveBeenCalledWith('valid.token');
            expect(mockSessionPort.isBanned).toHaveBeenCalledWith(payload.role, payload.sub);
        });

        it('should throw SystemException if cache service throws a non-unauthorized error', async () => {
            const payload = {
                role: UserRole.USER,
                sub: '018f43c3-6bb3-7d72-911e-848821a837c3',
            };

            mockTokenPort.verifyAccessToken.mockResolvedValue(payload);
            mockSessionPort.isBanned.mockRejectedValueOnce(new Error());

            await expect(guard.canActivate(createMockContext({ authorization: 'Bearer valid.token' }))).rejects.toThrow(
                SystemException,
            );
            expect(mockTokenPort.verifyAccessToken).toHaveBeenCalledWith('valid.token');
            expect(mockSessionPort.isBanned).toHaveBeenCalledWith(payload.role, payload.sub);
        });

        it('should return true and attach payload to request when token is valid and user is not blocklisted', async () => {
            const payload = { sub: '018f43c3-6bb3-7d72-911e-848821a837c3', role: UserRole.USER };

            mockTokenPort.verifyAccessToken.mockResolvedValue(payload);
            mockSessionPort.isBanned.mockResolvedValue(false);

            const context = createMockContext({ authorization: 'Bearer valid.token' });

            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(mockTokenPort.verifyAccessToken).toHaveBeenCalledWith('valid.token');
            expect(mockSessionPort.isBanned).toHaveBeenCalledWith(payload.role, payload.sub);
            expect(context.switchToHttp().getRequest<Record<string, unknown>>()['accessTokenPayload']).toEqual(payload);
        });
    });
});
