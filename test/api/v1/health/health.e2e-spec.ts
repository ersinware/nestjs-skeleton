/**
 * @file health.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating HealthController status and diagnostics.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { TOKEN_CACHE_HEALTH_PORT, type ICacheHealthPort } from 'src/core/cache';
import type { IDatabaseHealthPort } from 'src/core/database';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database';
import { ACCESS_TOKEN_TYPE, TOKEN_AUTH_ACCESS_TOKEN_PORT, type AccessTokenPayload } from 'src/core/security/auth';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { nowEpochSeconds } from 'src/shared/time';
import request from 'supertest';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HealthController', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp();
        const accessClaims: AccessTokenPayload = {
            sub: randomUUID(),
            sid: randomUUID(),
            exp: nowEpochSeconds() + 900,
            principalType: PrincipalType.ADMIN,
            permissions: [Permission.HEALTH_DETAIL_READ],
            sessionVersion: 0,
            type: ACCESS_TOKEN_TYPE,
        };
        vi.spyOn(
            app.get<ITokenPort<typeof ACCESS_TOKEN_TYPE>>(TOKEN_AUTH_ACCESS_TOKEN_PORT),
            'verify',
        ).mockResolvedValue(accessClaims);
        vi.spyOn(app.get<ISessionPort>(TOKEN_SESSION_PORT), 'isSessionActive').mockResolvedValue(true);
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /health/status - should return service health status', async () => {
        const cacheHealthIndicator = app.get<ICacheHealthPort>(TOKEN_CACHE_HEALTH_PORT);
        const databaseHealthIndicator = app.get<IDatabaseHealthPort>(TOKEN_DATABASE_HEALTH_PORT);

        // With no replica configured the replica health port is the primary's probe, so its ping
        // runs twice per check.
        const spyCache = vi.spyOn(cacheHealthIndicator, 'ping').mockResolvedValue(undefined);
        const spyDb = vi.spyOn(databaseHealthIndicator, 'ping').mockResolvedValue(undefined);

        await request(app.getHttpServer())
            .get('/api/health/status')
            .auth('health', { type: 'bearer' })
            .expect(200)
            .expect((res) => {
                expect(res.body).toStrictEqual({
                    data: {
                        status: 'ok',
                        info: {
                            memory_heap: { status: 'up' },
                            memory_rss: { status: 'up' },
                            database: { status: 'up' },
                            database_replica: { status: 'up' },
                            cache: { status: 'up' },
                            session: { status: 'up' },
                            rate_limit: { status: 'up' },
                        },
                        error: {},
                        details: {
                            memory_heap: { status: 'up' },
                            memory_rss: { status: 'up' },
                            database: { status: 'up' },
                            database_replica: { status: 'up' },
                            cache: { status: 'up' },
                            session: { status: 'up' },
                            rate_limit: { status: 'up' },
                        },
                    },
                });
            });

        expect(spyCache).toHaveBeenCalledTimes(1);
        expect(spyDb).toHaveBeenCalledTimes(2);
    });

    it('GET /health/status - should return 503 service unavailable when both Database and Cache are down', async () => {
        const cacheHealthIndicator = app.get<ICacheHealthPort>(TOKEN_CACHE_HEALTH_PORT);
        const databaseHealthIndicator = app.get<IDatabaseHealthPort>(TOKEN_DATABASE_HEALTH_PORT);

        const spyCache = vi.spyOn(cacheHealthIndicator, 'ping').mockRejectedValue(new Error('Cache failed'));
        const spyDb = vi.spyOn(databaseHealthIndicator, 'ping').mockRejectedValue(new Error('DB failed'));

        await request(app.getHttpServer())
            .get('/api/health/status')
            .auth('health', { type: 'bearer' })
            .expect(503)
            .expect((res) => {
                expect(res.body).toStrictEqual({
                    error: {
                        status: 'error',
                        info: {
                            memory_heap: { status: 'up' },
                            memory_rss: { status: 'up' },
                            session: { status: 'up' },
                            rate_limit: { status: 'up' },
                        },
                        error: {
                            database: {
                                status: 'down',
                                message: 'Database connection failed.',
                            },
                            database_replica: {
                                status: 'down',
                                message: 'Database replica connection failed.',
                            },
                            cache: {
                                status: 'down',
                                message: 'Cache connection failed.',
                            },
                        },
                        details: {
                            memory_heap: { status: 'up' },
                            memory_rss: { status: 'up' },
                            database: {
                                status: 'down',
                                message: 'Database connection failed.',
                            },
                            database_replica: {
                                status: 'down',
                                message: 'Database replica connection failed.',
                            },
                            cache: {
                                status: 'down',
                                message: 'Cache connection failed.',
                            },
                            session: { status: 'up' },
                            rate_limit: { status: 'up' },
                        },
                    },
                });
            });

        expect(spyCache).toHaveBeenCalledTimes(1);
        expect(spyDb).toHaveBeenCalledTimes(2);
    });
});
