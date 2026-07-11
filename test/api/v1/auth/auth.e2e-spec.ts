import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';

import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { uuidv7 } from 'uuidv7';
/**
 * @file auth.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating AuthController routes and token lifecycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccessDeniedType, ErrorDefaultDto, InvalidRequestType, UnauthenticatedType } from 'src/core/exception';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { PostLoginDto } from 'src/module/auth/presentation/dto/post-login.dto';
import { PostRefreshDto } from 'src/module/auth/presentation/dto/post-refresh.dto';
import { ResponseTokensDto } from 'src/module/auth/presentation/dto/response-tokens.dto';
import type { IUserWriterPort } from 'src/module/user/application/command/port/user-writer.port';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { AdminRole } from 'src/shared/domain/admin/enum/admin-role.enum';
import request from 'supertest';
import { createAuthTestApp } from 'test/shared/auth-test-app.factory';
import { cleanupCache } from 'test/shared/cache.cleaner';
import { cleanupDatabase } from 'test/shared/database.cleaner';
import { expectDataDto, expectErrorDto } from 'test/shared/dto-assertion.util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('AuthController', () => {
    let app: NestFastifyApplication,
        userWriterPort: IUserWriterPort,
        adminsRepository: IAdminWriterPort,
        hashingService: IHashingPort;

    beforeEach(async () => {
        app = await createAuthTestApp();
        userWriterPort = app.get(TOKEN_USER_WRITER_PORT);
        adminsRepository = app.get<IAdminWriterPort>(TOKEN_ADMIN_WRITER_PORT);
        hashingService = app.get<IHashingPort>(TOKEN_HASHING_PORT);

        await cleanupDatabase(app);
        await cleanupCache(app);
    });

    afterEach(async () => {
        await app.close();
    });

    describe('POST /auth/user/login', () => {
        it('should fail login when payload is empty', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/auth/user/login').send({}).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([InvalidRequestType.EMPTY_BODY]);
        });

        it('should fail login with invalid email format', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email: 'invalid-email',
                        password: 'Password123',
                    } satisfies PostLoginDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should fail login when password is missing', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email: 'user@example.com',
                    } satisfies Partial<PostLoginDto>)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should fail login with a non-existent email', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email: 'nonexistent@example.com',
                        password: 'Password123',
                    } satisfies PostLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.CREDENTIALS]);
        });

        it('should fail login when the user is inactive', async () => {
            const email = 'user.inactive@example.com',
                password = 'Password123';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Inactive User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email,
                        password,
                    } satisfies PostLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.CREDENTIALS]);
        });

        it('should fail login with an incorrect password', async () => {
            const email = 'user.wrongpass@example.com';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Test User',
                password: await hashingService.hash('Password123!'),
            });
            await userWriterPort.save(__userObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email,
                        password: 'WrongPassword123!',
                    } satisfies PostLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.CREDENTIALS]);
        });

        it('should allow login for a registered user, permit access to protected routes, and block access to admin/super-admin routes', async () => {
            const email = 'user@example.com',
                password = 'Password123!';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Test User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokensDto = expectDataDto(res.body, ResponseTokensDto);

            expect(tokensDto.accessToken).toBeDefined();
            expect(tokensDto.refreshToken).toBeDefined();

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${tokensDto.accessToken}`)
                .expect(200);

            const resAdminOnly = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/admin-only')
                    .set('Authorization', `Bearer ${tokensDto.accessToken}`)
                    .expect(403),
                errorDtoAdminOnly = expectErrorDto(resAdminOnly.body, ErrorDefaultDto);

            expect(errorDtoAdminOnly.statusCode).toBe(403);
            expect(errorDtoAdminOnly.message).toEqual([AccessDeniedType.DEFAULT]);

            const resSuperAdminOnly = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/super-admin-only')
                    .set('Authorization', `Bearer ${tokensDto.accessToken}`)
                    .expect(403),
                errorDtoSuperAdminOnly = expectErrorDto(resSuperAdminOnly.body, ErrorDefaultDto);

            expect(errorDtoSuperAdminOnly.statusCode).toBe(403);
            expect(errorDtoSuperAdminOnly.message).toEqual([AccessDeniedType.DEFAULT]);
        });
    });

    describe('POST /auth/admin/login', () => {
        it('should fail admin login when payload is empty', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/auth/admin/login').send({}).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([InvalidRequestType.EMPTY_BODY]);
        });

        it('should fail admin login with invalid email format', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email: 'invalid-email',
                        password: 'Password123',
                    } satisfies PostLoginDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should fail admin login when password is missing', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email: 'admin@example.com',
                    } satisfies Partial<PostLoginDto>)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should fail admin login with a non-existent email', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email: 'nonexistentadmin@example.com',
                        password: 'Password123',
                    } satisfies PostLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.CREDENTIALS]);
        });

        it('should fail admin login when the admin is inactive', async () => {
            const email = 'admin.inactive@example.com',
                password = 'Password123';

            const __adminObj = Admin.create(uuidv7(), {
                email,
                name: 'Inactive Admin',
                password: await hashingService.hash(password),
                role: AdminRole.ADMIN,
            });
            await adminsRepository.save(__adminObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email,
                        password,
                    } satisfies PostLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.CREDENTIALS]);
        });

        it('should fail admin login with an incorrect password', async () => {
            const email = 'admin.wrongpass@example.com';

            const __adminObj = Admin.create(uuidv7(), {
                email,
                name: 'Admin User',
                password: await hashingService.hash('Password123!'),
                role: AdminRole.ADMIN,
            });
            await adminsRepository.save(__adminObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email,
                        password: 'WrongPassword123!',
                    } satisfies PostLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.CREDENTIALS]);
        });

        it('should allow login for a registered admin and access admin-only endpoint', async () => {
            const email = 'admin@example.com',
                password = 'Password123!';

            const __adminObj = Admin.create(uuidv7(), {
                email,
                name: 'Test Admin',
                password: await hashingService.hash(password),
                role: AdminRole.ADMIN,
            });
            await adminsRepository.save(__adminObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokensDto = expectDataDto(res.body, ResponseTokensDto);

            expect(tokensDto.accessToken).toBeDefined();
            expect(tokensDto.refreshToken).toBeDefined();

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${tokensDto.accessToken}`)
                .expect(200);
        });

        it('should allow login for a registered super admin and access super-admin-only endpoint', async () => {
            const email = 'superadmin@example.com',
                password = 'Password123!';

            const __adminObj = Admin.create(uuidv7(), {
                email,
                name: 'Test Super Admin',
                password: await hashingService.hash(password),
                role: AdminRole.SUPER_ADMIN,
            });
            await adminsRepository.save(__adminObj);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokensDto = expectDataDto(res.body, ResponseTokensDto);

            expect(tokensDto.accessToken).toBeDefined();
            expect(tokensDto.refreshToken).toBeDefined();

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/super-admin-only')
                .set('Authorization', `Bearer ${tokensDto.accessToken}`)
                .expect(200);
        });
    });

    describe('POST /auth/refresh', () => {
        it('should fail rotation when payload is empty', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({}).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([InvalidRequestType.EMPTY_BODY]);
        });

        it('should fail rotation when refreshToken is not a valid JWT format', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: 'not-a-jwt-token',
                    } satisfies PostRefreshDto)
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
        });

        it('should fail rotation when refreshToken is a valid JWT format but has an invalid signature or is expired', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken:
                            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should fail rotation when access token is sent instead of refresh token', async () => {
            const email = 'user.accref@example.com',
                password = 'Password123!';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Test User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, ResponseTokensDto),
                resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.accessToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(resRefresh.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should successfully rotate tokens for an active registered user', async () => {
            const email = 'user.active@example.com',
                password = 'Password123!';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Active User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, ResponseTokensDto);

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${tokens.accessToken}`)
                .expect(200);

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(200),
                rotatedTokens = expectDataDto(resRefresh.body, ResponseTokensDto);

            expect(rotatedTokens.accessToken).toBeDefined();
            expect(rotatedTokens.refreshToken).toBeDefined();
            expect(rotatedTokens.refreshToken).not.toBe(tokens.refreshToken);

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${rotatedTokens.accessToken}`)
                .expect(200);
        });

        it('should successfully rotate tokens for an active registered admin', async () => {
            const email = 'admin.active@example.com',
                password = 'Password123!';

            const __adminObj = Admin.create(uuidv7(), {
                email,
                name: 'Active Admin',
                password: await hashingService.hash(password),
                role: AdminRole.ADMIN,
            });
            await adminsRepository.save(__adminObj);

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, ResponseTokensDto);

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${tokens.accessToken}`)
                .expect(200);

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(200),
                rotatedTokens = expectDataDto(resRefresh.body, ResponseTokensDto);

            expect(rotatedTokens.accessToken).toBeDefined();
            expect(rotatedTokens.refreshToken).toBeDefined();
            expect(rotatedTokens.refreshToken).not.toBe(tokens.refreshToken);

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${rotatedTokens.accessToken}`)
                .expect(200);
        });

        it('should fail rotation on token reuse (replay attack), evict all active sessions, and ban the user instantly', async () => {
            const email = 'user.replay@example.com',
                password = 'Password123!';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Replay User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                initialTokens = expectDataDto(resLogin.body, ResponseTokensDto),
                resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: initialTokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(200),
                rotatedTokens = expectDataDto(resRefresh.body, ResponseTokensDto);

            expect(rotatedTokens.refreshToken).not.toBe(initialTokens.refreshToken);

            const resReplay = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: initialTokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDtoReplay = expectErrorDto(resReplay.body, ErrorDefaultDto);

            expect(errorDtoReplay.statusCode).toBe(401);
            expect(errorDtoReplay.message).toEqual([UnauthenticatedType.DEFAULT]);

            const resEvicted = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: rotatedTokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDtoEvicted = expectErrorDto(resEvicted.body, ErrorDefaultDto);

            expect(errorDtoEvicted.statusCode).toBe(401);
            expect(errorDtoEvicted.message).toEqual([UnauthenticatedType.DEFAULT]);

            const resProtected = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/protected')
                    .set('Authorization', `Bearer ${rotatedTokens.accessToken}`)
                    .expect(401),
                errorDtoProtected = expectErrorDto(resProtected.body, ErrorDefaultDto);

            expect(errorDtoProtected.statusCode).toBe(401);
            expect(errorDtoProtected.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should fail rotation when the user is deactivated/banned after the token was issued', async () => {
            const email = 'user.deac@example.com',
                password = 'Password123!',
                user = User.create(uuidv7(), {
                    email,
                    name: 'Deactivated User',
                    password: await hashingService.hash(password),
                }),
                resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, ResponseTokensDto);

            user.updateStatus(false);
            await userWriterPort.save(user);
            await userWriterPort.save(user);

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(resRefresh.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should fail rotation when the admin is deactivated/banned after the token was issued', async () => {
            const email = 'admin.deac@example.com',
                password = 'Password123!',
                admin = Admin.create(uuidv7(), {
                    email,
                    name: 'Deactivated Admin',
                    password: await hashingService.hash(password),
                    role: AdminRole.ADMIN,
                }),
                resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, ResponseTokensDto);

            admin.updateStatus(false);
            await adminsRepository.save(admin);
            await adminsRepository.save(admin);

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(resRefresh.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });
    });

    describe('POST /auth/logout', () => {
        let accessToken: string, refreshToken: string;

        beforeEach(async () => {
            const email = 'logout.user@example.com',
                password = 'Password123!';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Logout User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const res = await request(app.getHttpServer())
                .post('/api/v1/auth/user/login')
                .send({ email, password } satisfies PostLoginDto)
                .expect(200);

            const tokens = expectDataDto(res.body, ResponseTokensDto);
            accessToken = tokens.accessToken;
            refreshToken = tokens.refreshToken;
        });

        it('should return 401 if access token is missing when calling logout', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/logout')
                    .send({
                        refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should return 400 if the logout request body is empty', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/logout')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toContain(InvalidRequestType.EMPTY_BODY);
        });

        it('should return 204 (swallowing the error) if the refresh token in the body is invalid but the caller has a valid access token', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    refreshToken:
                        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
                } satisfies PostRefreshDto)
                .expect(204);
        });

        it('should successfully logout by invalidating the refresh token session', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    refreshToken,
                } satisfies PostRefreshDto)
                .expect(204);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken,
                    } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });
    });

    describe('POST /auth/logout-all', () => {
        let accessToken: string, refreshToken: string;

        beforeEach(async () => {
            const email = 'logout.user@example.com',
                password = 'Password123!';

            const __userObj = User.create(uuidv7(), {
                email,
                name: 'Logout User',
                password: await hashingService.hash(password),
            });
            await userWriterPort.save(__userObj);

            const res = await request(app.getHttpServer())
                .post('/api/v1/auth/user/login')
                .send({
                    email,
                    password,
                } satisfies PostLoginDto)
                .expect(200);

            const tokens = expectDataDto(res.body, ResponseTokensDto);
            accessToken = tokens.accessToken;
            refreshToken = tokens.refreshToken;
        });

        it('should return 401 if access token is missing when calling logout-all', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/auth/logout-all').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 if access token is invalid when calling logout-all', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/logout-all')
                    .set('Authorization', 'Bearer invalid-access-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should successfully logout from all devices, clear all active sessions, and ban the current access token instantly', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/auth/logout-all')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(204);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({ refreshToken } satisfies PostRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);

            const resProtected = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/protected')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .expect(401),
                errorDtoProtected = expectErrorDto(resProtected.body, ErrorDefaultDto);

            expect(errorDtoProtected.statusCode).toBe(401);
            expect(errorDtoProtected.message).toEqual([UnauthenticatedType.DEFAULT]);
        });
    });
});
