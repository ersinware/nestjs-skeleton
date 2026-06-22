import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { TOKEN_USERS_REPOSITORY } from 'src/v1/user/constant/user.constant';
import { TOKEN_ADMINS_REPOSITORY } from 'src/v1/admin/constant/admin.constant';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { AuthTokenType } from 'src/common/enum/auth/auth-token-type.enum';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { AuditLogAction } from 'src/common/logger/enum/audit-log-action.enum';
import { AuditLogAuthReason } from 'src/common/logger/enum/audit-log-auth-reason.enum';
import * as Sentry from '@sentry/nestjs';
import { AuditLogPayload } from 'src/common/logger/audit-log-payload';
import { LogPayload } from 'src/common/logger/log-payload';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

interface CauseHolder {
    cause?: unknown;
}

describe('AuthService', () => {
    const mockUsersRepository = {
            findByEmail: vi.fn(),
            findById: vi.fn(),
        },
        mockAdminsRepository = {
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
        mockLogger = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        },
        loginDto: PostAuthLoginDto = { email: 'test@example.com', password: 'Password123!' };

    let service: AuthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: TOKEN_USERS_REPOSITORY, useValue: mockUsersRepository },
                { provide: TOKEN_ADMINS_REPOSITORY, useValue: mockAdminsRepository },
                { provide: TokenService, useValue: mockTokenService },
                { provide: SessionService, useValue: mockSessionService },
                { provide: HashingService, useValue: mockHashingService },
                {
                    provide: Logger,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        service = module.get(AuthService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('loginUser', () => {
        it('should throw UnauthorizedException if user does not exist', async () => {
            mockUsersRepository.findByEmail.mockResolvedValueOnce(null);

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

            expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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
            mockUsersRepository.findByEmail.mockResolvedValueOnce(principal);

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

            expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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

            mockUsersRepository.findByEmail.mockResolvedValueOnce(principal);
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

            expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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

            mockUsersRepository.findByEmail.mockResolvedValueOnce(principal);
            mockHashingService.verify.mockResolvedValueOnce(true);
            mockTokenService.generateTokens.mockResolvedValueOnce(tokens);

            expect(await service.loginUser(loginDto)).toEqual({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            });
            expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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
            mockAdminsRepository.findByEmail.mockResolvedValueOnce(null);

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

            expect(mockAdminsRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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
            mockAdminsRepository.findByEmail.mockResolvedValueOnce(principal);

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

            expect(mockAdminsRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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

            mockAdminsRepository.findByEmail.mockResolvedValueOnce(principal);
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

            expect(mockAdminsRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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

            mockAdminsRepository.findByEmail.mockResolvedValueOnce(principal);
            mockHashingService.verify.mockResolvedValueOnce(true);
            mockTokenService.generateTokens.mockResolvedValueOnce(tokens);

            expect(await service.loginAdmin(loginDto)).toEqual({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
            });
            expect(mockAdminsRepository.findByEmail).toHaveBeenCalledWith(loginDto.email);
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
            let repository: typeof mockUsersRepository | typeof mockAdminsRepository;

            beforeEach(() => {
                repository = repositoryName === 'users' ? mockUsersRepository : mockAdminsRepository;
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
                repository.findById.mockResolvedValueOnce(null);

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

    describe('logoutAll', () => {
        it('should close all sessions pattern', async () => {
            const userId = 'user-id',
                role = AuthUserRole.USER;

            await expect(service.logoutAll(role, userId)).resolves.toBeUndefined();

            expect(mockSessionService.closeAllSessions).toHaveBeenCalledWith(role, userId);
        });
    });

    describe('ban', () => {
        it('should ban the principal via sessionService', async () => {
            const userId = 'user-id',
                role = AuthUserRole.USER;

            await expect(service.ban(role, userId)).resolves.toBeUndefined();

            expect(mockSessionService.ban).toHaveBeenCalledWith(role, userId);
        });
    });

    describe('unban', () => {
        it('should call sessionService.unban with correct parameters', async () => {
            const userId = 'user-id',
                role = AuthUserRole.USER;

            await expect(service.unban(role, userId)).resolves.toBeUndefined();

            expect(mockSessionService.unban).toHaveBeenCalledWith(role, userId);
        });
    });
});
