/**
 * @file auth.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating AuthController routes and token lifecycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';
import { ForbiddenType } from 'src/common/enum/error/forbidden-type.enum';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { TOKEN_ADMINS_REPOSITORY } from 'src/v1/admin/constant/admin.constant';
import { IAdminsRepository } from 'src/v1/admin/interface/admins.repository.interface';
import { GetAuthTokensDto } from 'src/v1/auth/dto/get-auth-tokens.dto';
import { PostAuthLoginDto } from 'src/v1/auth/dto/post-auth-login.dto';
import { PostAuthRefreshDto } from 'src/v1/auth/dto/post-auth-refresh.dto';
import { TOKEN_USERS_REPOSITORY } from 'src/v1/user/constant/user.constant';
import { IUsersRepository } from 'src/v1/user/interface/users.repository.interface';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupCache } from '../../../shared/cache.cleaner';
import { cleanupDatabase } from '../../../shared/database.cleaner';
import { expectDataDto, expectErrorDto } from '../../../shared/dto-assertion.util';
import { createAuthTestApp } from '../../../shared/auth-test-app.factory';

describe('AuthController', () => {
    let app: NestFastifyApplication,
        usersRepository: IUsersRepository,
        adminsRepository: IAdminsRepository,
        hashingService: HashingService;

    beforeEach(async () => {
        app = await createAuthTestApp();
        usersRepository = app.get<IUsersRepository>(TOKEN_USERS_REPOSITORY);
        adminsRepository = app.get<IAdminsRepository>(TOKEN_ADMINS_REPOSITORY);
        hashingService = app.get<HashingService>(HashingService);

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
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should fail login with invalid email format', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email: 'invalid-email',
                        password: 'Password123',
                    } satisfies PostAuthLoginDto)
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
                    } satisfies Partial<PostAuthLoginDto>)
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
                    } satisfies PostAuthLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.CREDENTIALS]);
        });

        it('should fail login when the user is inactive', async () => {
            const email = 'user.inactive@example.com',
                password = 'Password123';

            await usersRepository.create({
                email,
                name: 'Inactive User',
                password: await hashingService.hash(password),
                isActive: false,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email,
                        password,
                    } satisfies PostAuthLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.CREDENTIALS]);
        });

        it('should fail login with an incorrect password', async () => {
            const email = 'user.wrongpass@example.com';

            await usersRepository.create({
                email,
                name: 'Test User',
                password: await hashingService.hash('Password123!'),
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({
                        email,
                        password: 'WrongPassword123!',
                    } satisfies PostAuthLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.CREDENTIALS]);
        });

        it('should allow login for a registered user, permit access to protected routes, and block access to admin/super-admin routes', async () => {
            const email = 'user@example.com',
                password = 'Password123!';

            await usersRepository.create({
                email,
                name: 'Test User',
                password: await hashingService.hash(password),
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokensDto = expectDataDto(res.body, GetAuthTokensDto);

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
            expect(errorDtoAdminOnly.message).toEqual([ForbiddenType.DEFAULT]);

            const resSuperAdminOnly = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/super-admin-only')
                    .set('Authorization', `Bearer ${tokensDto.accessToken}`)
                    .expect(403),
                errorDtoSuperAdminOnly = expectErrorDto(resSuperAdminOnly.body, ErrorDefaultDto);

            expect(errorDtoSuperAdminOnly.statusCode).toBe(403);
            expect(errorDtoSuperAdminOnly.message).toEqual([ForbiddenType.DEFAULT]);
        });
    });

    describe('POST /auth/admin/login', () => {
        it('should fail admin login when payload is empty', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/auth/admin/login').send({}).expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should fail admin login with invalid email format', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email: 'invalid-email',
                        password: 'Password123',
                    } satisfies PostAuthLoginDto)
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
                    } satisfies Partial<PostAuthLoginDto>)
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
                    } satisfies PostAuthLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.CREDENTIALS]);
        });

        it('should fail admin login when the admin is inactive', async () => {
            const email = 'admin.inactive@example.com',
                password = 'Password123';

            await adminsRepository.create({
                email,
                name: 'Inactive Admin',
                password: await hashingService.hash(password),
                role: AuthUserRole.ADMIN,
                isActive: false,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email,
                        password,
                    } satisfies PostAuthLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.CREDENTIALS]);
        });

        it('should fail admin login with an incorrect password', async () => {
            const email = 'admin.wrongpass@example.com';

            await adminsRepository.create({
                email,
                name: 'Admin User',
                password: await hashingService.hash('Password123!'),
                role: AuthUserRole.ADMIN,
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({
                        email,
                        password: 'WrongPassword123!',
                    } satisfies PostAuthLoginDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.CREDENTIALS]);
        });

        it('should allow login for a registered admin and access admin-only endpoint', async () => {
            const email = 'admin@example.com',
                password = 'Password123!';

            await adminsRepository.create({
                email,
                name: 'Test Admin',
                password: await hashingService.hash(password),
                role: AuthUserRole.ADMIN,
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokensDto = expectDataDto(res.body, GetAuthTokensDto);

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

            await adminsRepository.create({
                email,
                name: 'Test Super Admin',
                password: await hashingService.hash(password),
                role: AuthUserRole.SUPER_ADMIN,
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokensDto = expectDataDto(res.body, GetAuthTokensDto);

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
            expect(errorDto.message).toEqual([BadRequestType.EMPTY_BODY]);
        });

        it('should fail rotation when refreshToken is not a valid JWT format', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: 'not-a-jwt-token',
                    } satisfies PostAuthRefreshDto)
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
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should fail rotation when access token is sent instead of refresh token', async () => {
            const email = 'user.accref@example.com',
                password = 'Password123!';

            await usersRepository.create({
                email,
                name: 'Test User',
                password: await hashingService.hash(password),
                isActive: true,
            });

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, GetAuthTokensDto),
                resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.accessToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(resRefresh.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should successfully rotate tokens for an active registered user', async () => {
            const email = 'user.active@example.com',
                password = 'Password123!';

            await usersRepository.create({
                email,
                name: 'Active User',
                password: await hashingService.hash(password),
                isActive: true,
            });

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, GetAuthTokensDto);

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/protected')
                .set('Authorization', `Bearer ${tokens.accessToken}`)
                .expect(200);

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(200),
                rotatedTokens = expectDataDto(resRefresh.body, GetAuthTokensDto);

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

            await adminsRepository.create({
                email,
                name: 'Active Admin',
                password: await hashingService.hash(password),
                role: AuthUserRole.ADMIN,
                isActive: true,
            });

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, GetAuthTokensDto);

            await request(app.getHttpServer())
                .get('/api/v1/auth-trigger/admin-only')
                .set('Authorization', `Bearer ${tokens.accessToken}`)
                .expect(200);

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(200),
                rotatedTokens = expectDataDto(resRefresh.body, GetAuthTokensDto);

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

            await usersRepository.create({
                email,
                name: 'Replay User',
                password: await hashingService.hash(password),
                isActive: true,
            });

            const resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                initialTokens = expectDataDto(resLogin.body, GetAuthTokensDto),
                resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: initialTokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(200),
                rotatedTokens = expectDataDto(resRefresh.body, GetAuthTokensDto);

            expect(rotatedTokens.refreshToken).not.toBe(initialTokens.refreshToken);

            const resReplay = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: initialTokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDtoReplay = expectErrorDto(resReplay.body, ErrorDefaultDto);

            expect(errorDtoReplay.statusCode).toBe(401);
            expect(errorDtoReplay.message).toEqual([UnauthorizedType.TOKEN]);

            const resEvicted = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: rotatedTokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDtoEvicted = expectErrorDto(resEvicted.body, ErrorDefaultDto);

            expect(errorDtoEvicted.statusCode).toBe(401);
            expect(errorDtoEvicted.message).toEqual([UnauthorizedType.TOKEN]);

            const resProtected = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/protected')
                    .set('Authorization', `Bearer ${rotatedTokens.accessToken}`)
                    .expect(401),
                errorDtoProtected = expectErrorDto(resProtected.body, ErrorDefaultDto);

            expect(errorDtoProtected.statusCode).toBe(401);
            expect(errorDtoProtected.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should fail rotation when the user is deactivated/banned after the token was issued', async () => {
            const email = 'user.deac@example.com',
                password = 'Password123!',
                user = await usersRepository.create({
                    email,
                    name: 'Deactivated User',
                    password: await hashingService.hash(password),
                    isActive: true,
                }),
                resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/user/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, GetAuthTokensDto);

            await usersRepository.update(user!.id, { isActive: false });

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(resRefresh.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should fail rotation when the admin is deactivated/banned after the token was issued', async () => {
            const email = 'admin.deac@example.com',
                password = 'Password123!',
                admin = await adminsRepository.create({
                    email,
                    name: 'Deactivated Admin',
                    password: await hashingService.hash(password),
                    role: AuthUserRole.ADMIN,
                    isActive: true,
                }),
                resLogin = await request(app.getHttpServer())
                    .post('/api/v1/auth/admin/login')
                    .send({ email, password } satisfies PostAuthLoginDto)
                    .expect(200),
                tokens = expectDataDto(resLogin.body, GetAuthTokensDto);

            await adminsRepository.update(admin!.id, { isActive: false });

            const resRefresh = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken: tokens.refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(resRefresh.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });
    });

    describe('POST /auth/logout', () => {
        let accessToken: string, refreshToken: string;

        beforeEach(async () => {
            const email = 'logout.user@example.com',
                password = 'Password123!';

            await usersRepository.create({
                email,
                name: 'Logout User',
                password: await hashingService.hash(password),
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                .post('/api/v1/auth/user/login')
                .send({ email, password } satisfies PostAuthLoginDto)
                .expect(200);

            const tokens = expectDataDto(res.body, GetAuthTokensDto);
            accessToken = tokens.accessToken;
            refreshToken = tokens.refreshToken;
        });

        it('should return 401 if access token is missing when calling logout', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/logout')
                    .send({
                        refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 400 if the logout request body is empty', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/logout')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .send({})
                    .expect(400),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(400);
            expect(errorDto.message).toContain(BadRequestType.EMPTY_BODY);
        });

        it('should return 204 (swallowing the error) if the refresh token in the body is invalid but the caller has a valid access token', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    refreshToken:
                        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
                } satisfies PostAuthRefreshDto)
                .expect(204);
        });

        it('should successfully logout by invalidating the refresh token session', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    refreshToken,
                } satisfies PostAuthRefreshDto)
                .expect(204);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({
                        refreshToken,
                    } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });
    });

    describe('POST /auth/logout-all', () => {
        let accessToken: string, refreshToken: string;

        beforeEach(async () => {
            const email = 'logout.user@example.com',
                password = 'Password123!';

            await usersRepository.create({
                email,
                name: 'Logout User',
                password: await hashingService.hash(password),
                isActive: true,
            });

            const res = await request(app.getHttpServer())
                .post('/api/v1/auth/user/login')
                .send({
                    email,
                    password,
                } satisfies PostAuthLoginDto)
                .expect(200);

            const tokens = expectDataDto(res.body, GetAuthTokensDto);
            accessToken = tokens.accessToken;
            refreshToken = tokens.refreshToken;
        });

        it('should return 401 if access token is missing when calling logout-all', async () => {
            const res = await request(app.getHttpServer()).post('/api/v1/auth/logout-all').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should return 401 if access token is invalid when calling logout-all', async () => {
            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/logout-all')
                    .set('Authorization', 'Bearer invalid-access-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should successfully logout from all devices, clear all active sessions, and ban the current access token instantly', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/auth/logout-all')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(204);

            const res = await request(app.getHttpServer())
                    .post('/api/v1/auth/refresh')
                    .send({ refreshToken } satisfies PostAuthRefreshDto)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);

            const resProtected = await request(app.getHttpServer())
                    .get('/api/v1/auth-trigger/protected')
                    .set('Authorization', `Bearer ${accessToken}`)
                    .expect(401),
                errorDtoProtected = expectErrorDto(resProtected.body, ErrorDefaultDto);

            expect(errorDtoProtected.statusCode).toBe(401);
            expect(errorDtoProtected.message).toEqual([UnauthorizedType.TOKEN]);
        });
    });
});
