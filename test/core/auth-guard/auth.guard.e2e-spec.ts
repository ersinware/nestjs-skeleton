/**
 * @file auth.guard.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating AuthGuard route protection, JWT payload injection, and cache blocklisting.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_CACHE_SERVICE } from 'src/cache/constant/cache.constant';
import type { ICacheService } from 'src/cache/interface/cache-service.interface';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { AuthTokenType } from 'src/common/guard/enum/auth-token-type.enum';
import { AuthUserRole } from 'src/common/guard/enum/auth-user-role.enum';
import { UnauthorizedType } from 'src/common/decorator/enum/unauthorized-type.enum';
import { InternalServerErrorType } from 'src/common/decorator/enum/internal-server-error-type.enum';
import type { AccessTokenPayload } from 'src/common/guard/interface/auth.interface';
import { TokenService } from 'src/v1/auth/token.service';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupCache } from '../../shared/cache.cleaner';
import { expectErrorDto } from '../../shared/dto-assertion.util';
import { createAuthGuardTestApp } from './auth.guard.fixture';

describe('AuthGuard', () => {
    let app: NestFastifyApplication, tokenService: TokenService, cacheService: ICacheService;

    beforeEach(async () => {
        app = await createAuthGuardTestApp();
        tokenService = app.get<TokenService>(TokenService);
        cacheService = app.get<ICacheService>(TOKEN_CACHE_SERVICE);

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
            expect(errorDto.message).toEqual([UnauthorizedType.MISSING_CREDENTIALS]);
        });

        it('should throw 401 when authorization type is not Bearer', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Basic sometoken')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should throw 401 when authorization token is missing in Bearer header', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Bearer ')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should throw 401 when token is invalid', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', 'Bearer invalidtokenhere')
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should throw 401 when token is expired', async () => {
            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set(
                        'Authorization',
                        `Bearer ${await tokenService.generateAccessToken(AuthUserRole.USER, 'expired-user-id', '0s')}`,
                    )
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should throw 401 when the user is banned in cache', async () => {
            const userId = 'banned-user-id',
                role = AuthUserRole.USER,
                token = await tokenService.generateAccessToken(role, userId);

            // Set the ban key in cache
            await cacheService.set(`banned:${role}:${userId}`, 'true', 3600);

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', `Bearer ${token}`)
                    .expect(401),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(401);
            expect(errorDto.message).toEqual([UnauthorizedType.TOKEN]);
        });

        it('should throw 500 when the cache service throws an unexpected error', async () => {
            vi.spyOn(cacheService, 'exists').mockRejectedValueOnce(new Error());

            const res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set(
                        'Authorization',
                        `Bearer ${await tokenService.generateAccessToken(AuthUserRole.USER, 'active-user-id')}`,
                    )
                    .expect(500),
                errorDto = expectErrorDto(res.body, ErrorDefaultDto);

            expect(errorDto.statusCode).toBe(500);
            expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
        });

        it('should allow access and inject the token payload into request context when the token is valid and active', async () => {
            const userId = 'active-user-id',
                role = AuthUserRole.USER,
                res = await request(app.getHttpServer())
                    .get('/api/v1/auth-guard-trigger/protected')
                    .set('Authorization', `Bearer ${await tokenService.generateAccessToken(role, userId)}`)
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
