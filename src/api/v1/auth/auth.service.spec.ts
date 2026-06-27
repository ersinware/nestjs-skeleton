/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file auth.service.spec.ts
 * @description Unit tests for the AuthService. Ensures that credential verification, token generation, session lifecycle, and strict security rules like replay attack detection function correctly.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { TOKEN_TOKEN_SERVICE } from 'src/common/port/security/token.constant';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { TOKEN_ADMIN_IDENTITY_PROVIDER, TOKEN_USER_IDENTITY_PROVIDER } from './constant/auth.constant';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { AuthTokenType } from 'src/common/auth/enum/auth-token-type.enum';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { AuditLogAction } from 'src/common/port/logger/enum/audit-log-action.enum';
import { AuditLogAuthReason } from 'src/common/port/logger/enum/audit-log-auth-reason.enum';
import * as Sentry from '@sentry/nestjs';
import { AuditLogPayload } from 'src/common/port/logger/payload/audit-log-payload';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

interface CauseHolder {
    cause?: unknown;
}

describe('AuthService', () => {
    const mockUserService = {
            findByEmail: vi.fn(),
            findById: vi.fn(),
        },
        mockAdminService = {
            findByEmail: vi.fn(),
            findById: vi.fn(),
        },
        mockTokenService = {
            generateTokens: vi.fn(),
            verifyRefreshToken: vi.fn(),
        },
        mockSessionService = {
            openSession: vi.fn(),
            getSession: vi.fn(),
            closeSession: vi.fn(),
            closeAllSessions: vi.fn(),
            ban: vi.fn(),
            unban: vi.fn(),
        },
        mockHashingService = {
            verify: vi.fn(),
        },
        mockLogger: ILoggerService = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
            debug: vi.fn(),
            verbose: vi.fn(),
        },
        loginDto: PostAuthLoginDto = { email: 'test@example.com', password: 'Password123!' };

    let service: AuthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: TOKEN_USER_IDENTITY_PROVIDER, useValue: mockUserService },
                { provide: TOKEN_ADMIN_IDENTITY_PROVIDER, useValue: mockAdminService },
                { provide: TOKEN_TOKEN_SERVICE, useValue: mockTokenService },
                { provide: TOKEN_SESSION_SERVICE, useValue: mockSessionService },
                { provide: TOKEN_HASHING_SERVICE, useValue: mockHashingService },
                { provide: TOKEN_LOGGER_SERVICE, useValue: mockLogger },
            ],
        }).compile();

        service = module.get(AuthService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('loginUser', () => {
        it('should throw UnauthorizedException if user does not exist', async () => {
            mockUserService.findByEmail.mockRejectedValueOnce(new Error('Not Found'));

            let exception: unknown;
            try {
                await service.loginUser(loginDto);
            } catch (err) {
                exception = err;
            }

            expect(exception).toBeInstanceOf(UnauthorizedException);
            const cause = (exception as CauseHolder).cause;
            expect(cause).toBeInstanceOf(AuditLogPayload);
            expect(cause).toEqual(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginUser.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub: undefined,
                    role: AuthUserRole.USER,
                }),
            );

            expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if user exists but is not active', async () => {
            const principal = {
                id: 'user-id',
                email: loginDto.email,
                password: 'hashed-password',
                isActive: false,
            };
            mockUserService.findByEmail.mockResolvedValueOnce(principal);

            let exception: unknown;
            try {
                await service.loginUser(loginDto);
            } catch (err) {
                exception = err;
            }

            expect(exception).toBeInstanceOf(UnauthorizedException);
            const cause = (exception as CauseHolder).cause;
            expect(cause).toBeInstanceOf(AuditLogPayload);
            expect(cause).toEqual(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginUser.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INACTIVE_ACCOUNT,
                    sub: principal.id,
                    role: AuthUserRole.USER,
                }),
            );

            expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if password verification fails', async () => {
            const principal = {
                id: 'user-id',
                email: loginDto.email,
                password: 'hashed-password',
                isActive: true,
            };

            mockUserService.findByEmail.mockResolvedValueOnce(principal);
            mockHashingService.verify.mockResolvedValueOnce(false);

            let exception: unknown;
            try {
                await service.loginUser(loginDto);
            } catch (err) {
                exception = err;
            }

            expect(exception).toBeInstanceOf(UnauthorizedException);
            const cause = (exception as CauseHolder).cause;
            expect(cause).toBeInstanceOf(AuditLogPayload);
            expect(cause).toEqual(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginUser.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INVALID_PASSWORD,
                    sub: principal.id,
                    role: AuthUserRole.USER,
                }),
            );

            expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).toHaveBeenCalledWith(principal.password, loginDto.password);
            expect(mockLogger.warn).not.toHaveBeenCalled();
            expect(mockTokenService.generateTokens).not.toHaveBeenCalled();
        });

        it('should successfully log in, open a session, and return tokens', async () => {
            const principal = {
                    id: 'user-id',
                    email: loginDto.email,
                    password: 'hashed-password',
                    isActive: true,
                },
                tokens = {
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    jti: '00000000-0000-0000-0000-000000000000',
                };

            mockUserService.findByEmail.mockResolvedValueOnce(principal);
            mockHashingService.verify.mockResolvedValueOnce(true);
            mockTokenService.generateTokens.mockResolvedValueOnce(tokens);

            expect(await service.loginUser(loginDto)).toEqual({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            });
            expect(mockUserService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).toHaveBeenCalledWith(principal.password, loginDto.password);
            expect(mockTokenService.generateTokens).toHaveBeenCalledWith(AuthUserRole.USER, principal.id);
            expect(mockSessionService.openSession).toHaveBeenCalledWith(AuthUserRole.USER, principal.id, tokens.jti);
            expect(mockLogger.log).toHaveBeenCalledWith(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginUser.name,
                    action: AuditLogAction.LOGIN_SUCCESS,
                    sub: principal.id,
                    role: AuthUserRole.USER,
                }),
            );
        });
    });

    describe('loginAdmin', () => {
        it('should throw UnauthorizedException if admin does not exist', async () => {
            mockAdminService.findByEmail.mockRejectedValueOnce(new Error('Not Found'));

            let exception: unknown;
            try {
                await service.loginAdmin(loginDto);
            } catch (err) {
                exception = err;
            }

            expect(exception).toBeInstanceOf(UnauthorizedException);
            const cause = (exception as CauseHolder).cause;
            expect(cause).toBeInstanceOf(AuditLogPayload);
            expect(cause).toEqual(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginAdmin.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub: undefined,
                    role: AuthUserRole.ADMIN,
                }),
            );

            expect(mockAdminService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if admin exists but is not active', async () => {
            const principal = {
                id: 'admin-id',
                email: loginDto.email,
                password: 'hashed-password',
                isActive: false,
            };
            mockAdminService.findByEmail.mockResolvedValueOnce(principal);

            let exception: unknown;
            try {
                await service.loginAdmin(loginDto);
            } catch (err) {
                exception = err;
            }

            expect(exception).toBeInstanceOf(UnauthorizedException);
            const cause = (exception as CauseHolder).cause;
            expect(cause).toBeInstanceOf(AuditLogPayload);
            expect(cause).toEqual(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginAdmin.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INACTIVE_ACCOUNT,
                    sub: principal.id,
                    role: AuthUserRole.ADMIN,
                }),
            );

            expect(mockAdminService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('should throw UnauthorizedException if password verification fails', async () => {
            const principal = {
                id: 'admin-id',
                email: loginDto.email,
                password: 'hashed-password',
                isActive: true,
            };

            mockAdminService.findByEmail.mockResolvedValueOnce(principal);
            mockHashingService.verify.mockResolvedValueOnce(false);

            let exception: unknown;
            try {
                await service.loginAdmin(loginDto);
            } catch (err) {
                exception = err;
            }

            expect(exception).toBeInstanceOf(UnauthorizedException);
            const cause = (exception as CauseHolder).cause;
            expect(cause).toBeInstanceOf(AuditLogPayload);
            expect(cause).toEqual(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginAdmin.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INVALID_PASSWORD,
                    sub: principal.id,
                    role: AuthUserRole.ADMIN,
                }),
            );

            expect(mockAdminService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).toHaveBeenCalledWith(principal.password, loginDto.password);
            expect(mockLogger.warn).not.toHaveBeenCalled();
            expect(mockTokenService.generateTokens).not.toHaveBeenCalled();
        });

        it('should successfully log in, open a session, and return tokens', async () => {
            const principal = {
                    id: 'admin-id',
                    email: loginDto.email,
                    password: 'hashed-password',
                    role: AuthUserRole.ADMIN,
                    isActive: true,
                },
                tokens = {
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    jti: '00000000-0000-0000-0000-000000000000',
                };

            mockAdminService.findByEmail.mockResolvedValueOnce(principal);
            mockHashingService.verify.mockResolvedValueOnce(true);
            mockTokenService.generateTokens.mockResolvedValueOnce(tokens);

            expect(await service.loginAdmin(loginDto)).toEqual({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            });
            expect(mockAdminService.findByEmail).toHaveBeenCalledWith(loginDto.email);
            expect(mockHashingService.verify).toHaveBeenCalledWith(principal.password, loginDto.password);
            expect(mockTokenService.generateTokens).toHaveBeenCalledWith(AuthUserRole.ADMIN, principal.id);
            expect(mockSessionService.openSession).toHaveBeenCalledWith(AuthUserRole.ADMIN, principal.id, tokens.jti);
            expect(mockLogger.log).toHaveBeenCalledWith(
                new AuditLogPayload({
                    class: AuthService.name,
                    method: service.loginAdmin.name,
                    action: AuditLogAction.LOGIN_SUCCESS,
                    sub: principal.id,
                    role: AuthUserRole.ADMIN,
                }),
            );
        });
    });

    describe('refresh', () => {
        const refreshDto = { refreshToken: 'valid-refresh-token' };

        it('should throw UnauthorizedException if token verification fails', async () => {
            mockTokenService.verifyRefreshToken.mockRejectedValueOnce(new Error());

            await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
            expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
        });

        it('should throw UnauthorizedException if token type is not REFRESH', async () => {
            const payload = {
                type: AuthTokenType.ACCESS,
            };

            mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);

            await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
            expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
        });

        describe('replay attack detection', () => {
            it('should close all sessions, ban the user, and throw UnauthorizedException if the session does not exist in cache', async () => {
                const payload = {
                    sub: 'user-id',
                    role: AuthUserRole.USER,
                    jti: 'stale-jti',
                    type: AuthTokenType.REFRESH,
                };

                mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);
                mockSessionService.getSession.mockResolvedValueOnce(null);

                let exception: unknown;
                try {
                    await service.refresh(refreshDto);
                } catch (err) {
                    exception = err;
                }

                expect(exception).toBeInstanceOf(UnauthorizedException);
                const cause = (exception as CauseHolder).cause;
                expect(cause).toBeInstanceOf(AuditLogPayload);
                expect(cause).toEqual(
                    new AuditLogPayload({
                        class: AuthService.name,
                        method: service.refresh.name,
                        action: AuditLogAction.REPLAY_ATTACK,
                        sub: payload.sub,
                        role: payload.role,
                        jti: payload.jti,
                    }),
                );

                expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
                expect(mockSessionService.getSession).toHaveBeenCalledWith(payload.role, payload.sub, payload.jti);
                expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(payload.role, payload.sub);
                expect(mockSessionService.ban).toHaveBeenCalledWith(payload.role, payload.sub);
                expect(mockLogger.warn).not.toHaveBeenCalled();
            });
        });

        describe.each([
            { role: AuthUserRole.USER, principalId: 'user-id', repositoryName: 'users' as const },
            { role: AuthUserRole.ADMIN, principalId: 'admin-id', repositoryName: 'admins' as const },
        ])('normal rotation flow for $role', ({ role, principalId, repositoryName }) => {
            let repository: typeof mockUserService | typeof mockAdminService;

            beforeEach(() => {
                repository = repositoryName === 'users' ? mockUserService : mockAdminService;
            });

            it('should close old session, verify principal is active and exist, open new session, and return new tokens', async () => {
                const payload = {
                        sub: principalId,
                        role,
                        jti: 'old-jti',
                        type: AuthTokenType.REFRESH,
                    },
                    principal = {
                        id: principalId,
                        isActive: true,
                        role,
                    },
                    newTokens = {
                        accessToken: 'new-access-token',
                        refreshToken: 'new-refresh-token',
                        jti: '11111111-1111-1111-1111-111111111111',
                    };

                mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);
                mockSessionService.getSession.mockResolvedValueOnce('1');
                repository.findById.mockResolvedValueOnce(principal);
                mockTokenService.generateTokens.mockResolvedValueOnce(newTokens);

                expect(await service.refresh(refreshDto)).toEqual({
                    accessToken: newTokens.accessToken,
                    refreshToken: newTokens.refreshToken,
                });
                expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
                expect(mockSessionService.getSession).toHaveBeenCalledWith(role, principalId, payload.jti);
                expect(mockSessionService.closeSession).toHaveBeenCalledWith(role, principalId, payload.jti);
                expect(repository.findById).toHaveBeenCalledWith(principalId);
                expect(mockTokenService.generateTokens).toHaveBeenCalledWith(role, principalId);
                expect(mockSessionService.openSession).toHaveBeenCalledWith(role, principalId, newTokens.jti);
            });

            it('should throw UnauthorizedException if the principal does not exist in repository', async () => {
                const payload = {
                    sub: principalId,
                    role,
                    jti: 'old-jti',
                    type: AuthTokenType.REFRESH,
                };

                mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);
                mockSessionService.getSession.mockResolvedValueOnce('1');
                repository.findById.mockRejectedValueOnce(new Error('Not Found'));

                let exception: unknown;
                try {
                    await service.refresh(refreshDto);
                } catch (err) {
                    exception = err;
                }

                expect(exception).toBeInstanceOf(UnauthorizedException);
                const cause = (exception as CauseHolder).cause;
                expect(cause).toBeInstanceOf(AuditLogPayload);
                expect(cause).toEqual(
                    new AuditLogPayload({
                        class: AuthService.name,
                        method: service.refresh.name,
                        action: AuditLogAction.LOGIN_FAILED,
                        reason: AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                        sub: principalId,
                        role,
                    }),
                );

                expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
                expect(mockSessionService.getSession).toHaveBeenCalledWith(role, principalId, payload.jti);
                expect(mockSessionService.closeSession).toHaveBeenCalledWith(role, principalId, payload.jti);
                expect(repository.findById).toHaveBeenCalledWith(principalId);
            });

            it('should throw UnauthorizedException if the principal exists but is not active', async () => {
                const payload = {
                        sub: principalId,
                        role,
                        jti: 'old-jti',
                        type: AuthTokenType.REFRESH,
                    },
                    principal = {
                        id: principalId,
                        isActive: false,
                        role,
                    };

                mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);
                mockSessionService.getSession.mockResolvedValueOnce('1');
                repository.findById.mockResolvedValueOnce(principal);

                let exception: unknown;
                try {
                    await service.refresh(refreshDto);
                } catch (err) {
                    exception = err;
                }

                expect(exception).toBeInstanceOf(UnauthorizedException);
                const cause = (exception as CauseHolder).cause;
                expect(cause).toBeInstanceOf(AuditLogPayload);
                expect(cause).toEqual(
                    new AuditLogPayload({
                        class: AuthService.name,
                        method: service.refresh.name,
                        action: AuditLogAction.LOGIN_FAILED,
                        reason: AuditLogAuthReason.INACTIVE_ACCOUNT,
                        sub: principalId,
                        role,
                    }),
                );

                expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
                expect(mockSessionService.getSession).toHaveBeenCalledWith(role, principalId, payload.jti);
                expect(mockSessionService.closeSession).toHaveBeenCalledWith(role, principalId, payload.jti);
                expect(repository.findById).toHaveBeenCalledWith(principalId);
            });
        });
    });

    describe('logout', () => {
        const refreshDto = { refreshToken: 'valid-refresh-token' };

        it('should do nothing and return if refresh token verification fails', async () => {
            mockTokenService.verifyRefreshToken.mockRejectedValueOnce(new Error());

            await expect(service.logout(refreshDto)).resolves.toBeUndefined();
            expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
            expect(mockSessionService.closeSession).not.toHaveBeenCalled();
        });

        it('should close the session when token is verified successfully', async () => {
            const payload = {
                sub: 'user-id',
                role: AuthUserRole.USER,
                jti: 'active-jti',
                type: AuthTokenType.REFRESH,
            };

            mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);

            await expect(service.logout(refreshDto)).resolves.toBeUndefined();
            expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
            expect(mockSessionService.closeSession).toHaveBeenCalledWith(payload.role, payload.sub, payload.jti);
        });

        it('should swallow and log any errors thrown during session closure', async () => {
            const payload = {
                    sub: 'user-id',
                    role: AuthUserRole.USER,
                    jti: 'active-jti',
                    type: AuthTokenType.REFRESH,
                },
                error = new Error();

            mockTokenService.verifyRefreshToken.mockResolvedValueOnce(payload);
            mockSessionService.closeSession.mockRejectedValueOnce(error);

            await expect(service.logout(refreshDto)).resolves.toBeUndefined();
            expect(mockTokenService.verifyRefreshToken).toHaveBeenCalledWith(refreshDto.refreshToken);
            expect(mockSessionService.closeSession).toHaveBeenCalledWith(payload.role, payload.sub, payload.jti);

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: AuthService.name,
                    method: service.logout.name,
                    error,
                }),
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(error);
        });
    });
});
