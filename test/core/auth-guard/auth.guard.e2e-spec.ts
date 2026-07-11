/**
 * @file auth.guard.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating AuthGuard route protection, JWT payload injection, and cache blocklisting.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ErrorDefaultDto, InternalServerErrorType, UnauthenticatedType } from 'src/core/exception';
import type { AccessTokenPayload, ITokenPort } from 'src/core/security';
import { AuthTokenType, TOKEN_TOKEN_PORT } from 'src/core/security';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session/port';
import { UserRole } from 'src/shared/domain/user/enum/user-role.enum';
import request from 'supertest';
import { createAuthGuardTestApp } from 'test/core/auth-guard/auth.guard.fixture';
import { cleanupCache } from 'test/shared/cache.cleaner';
import { expectErrorDto } from 'test/shared/dto-assertion.util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuthGuard', () => {
    let app: NestFastifyApplication, tokenPort: ITokenPort, sessionPort: ISessionPort;

    beforeEach(async () => {
        app = await createAuthGuardTestApp();
        tokenPort = app.get<ITokenPort>(TOKEN_TOKEN_PORT);
        sessionPort = app.get<ISessionPort>(TOKEN_SESSION_PORT);

        await cleanupCache(app);
    });

    afterEach(async () => {
        await app.close();
    });

    describe('GET /auth-guard-trigger/public', () => {
        it('should bypass auth guard and allow access to public routes without credentials', async () => {
            await request(app.getHttpServer()).get('/api/v1/auth-guard-trigger/public').expect(200);
        });
    });

    describe('GET /auth-guard-trigger/protected', () => {
        it('should throw 401 when no authorization header is provided', async () => {
            const res = await request(app.getHttpServer()).get('/api/v1/auth-guard-trigger/protected').expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.MISSING_CREDENTIALS]);
        });

        it('should throw 401 when authorization type is not Bearer', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Basic sometoken')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should throw 401 when authorization token is missing in Bearer header', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Bearer ')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should throw 401 when token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Bearer invalidtokenhere')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should throw 401 when token is expired', async () => {
            vi.spyOn(tokenPort, 'verifyAccessToken').mockRejectedValueOnce(new Error('jwt expired'));

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Bearer expired-token')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should throw 401 when the user is banned in cache', async () => {
            const userId = 'banned-user-id',
                role = UserRole.USER,
                token = await tokenPort.generateAccessToken(role, userId);

            // Set the ban key in cache state
            await sessionPort.ban(role, userId);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', `Bearer ${token}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthenticatedType.DEFAULT]);
        });

        it('should throw 500 when the cache service throws an unexpected error', async () => {
            vi.spyOn(sessionPort, 'isBanned').mockRejectedValueOnce(new Error());

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set(
                        'Authorization',
                        `Bearer ${await tokenPort.generateAccessToken(UserRole.USER, 'active-user-id')}`,
                    )
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should allow access and inject the token payload into request context when the token is valid and active', async () => {
            const userId = 'active-user-id',
                role = UserRole.USER,
                res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', `Bearer ${await tokenPort.generateAccessToken(role, userId)}`)
                    .expect(200),
                body = res.body as { data: AccessTokenPayload };

            expect(body.data).toEqual(
                expect.objectContaining({
                    sub: userId,
                    role,
                    type: AuthTokenType.ACCESS,
                }),
            );
        });
    });
});
