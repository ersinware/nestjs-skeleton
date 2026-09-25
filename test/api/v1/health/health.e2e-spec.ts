/**
 * @file health.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating HealthController status and diagnostics.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { TOKEN_CACHE_HEALTH_PORT, type ICacheHealthPort } from 'src/core/cache';
import type { IDatabaseHealthPort } from 'src/core/database';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import request from 'supertest';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HealthController', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp();
        vi.spyOn(app.get<ITokenPort>(TOKEN_TOKEN_PORT), 'verifyAccessToken').mockResolvedValue({
            sub: randomUUID(),
            sid: randomUUID(),
            sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
            exp: Math.floor(Date.now() / 1000) + 900,
            principalType: PrincipalType.ADMIN,
            permissions: [Permission.HEALTH_DETAIL_READ],
            sessionVersion: 0,
            type: AuthTokenType.ACCESS,
        });
        vi.spyOn(app.get<ISessionPort>(TOKEN_SESSION_PORT), 'isSessionActive').mockResolvedValue(true);
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /health - should return service health status', async () => {
        const cacheHealthIndicator = app.get<ICacheHealthPort>(TOKEN_CACHE_HEALTH_PORT);
        const databaseHealthIndicator = app.get<IDatabaseHealthPort>(TOKEN_DATABASE_HEALTH_PORT);

        // With no replica configured the replica health port is the primary's probe, so its ping
        // runs twice per check.
        const spyCache = vi.spyOn(cacheHealthIndicator, 'ping').mockResolvedValue(undefined);
        const spyDb = vi.spyOn(databaseHealthIndicator, 'ping').mockResolvedValue(undefined);

        await request(app.getHttpServer())
            .get('/api/health')
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
                        },
                        error: {},
                        details: {
                            memory_heap: { status: 'up' },
                            memory_rss: { status: 'up' },
                            database: { status: 'up' },
                            database_replica: { status: 'up' },
                            cache: { status: 'up' },
                            session: { status: 'up' },
                        },
                    },
                });
            });

        expect(spyCache).toHaveBeenCalledTimes(1);
        expect(spyDb).toHaveBeenCalledTimes(2);
    });

    it('GET /health - should return 503 service unavailable when both Database and Cache are down', async () => {
        const cacheHealthIndicator = app.get<ICacheHealthPort>(TOKEN_CACHE_HEALTH_PORT);
        const databaseHealthIndicator = app.get<IDatabaseHealthPort>(TOKEN_DATABASE_HEALTH_PORT);

        const spyCache = vi.spyOn(cacheHealthIndicator, 'ping').mockRejectedValue(new Error('Cache failed'));
        const spyDb = vi.spyOn(databaseHealthIndicator, 'ping').mockRejectedValue(new Error('DB failed'));

        await request(app.getHttpServer())
            .get('/api/health')
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
                        },
                    },
                });
            });

        expect(spyCache).toHaveBeenCalledTimes(1);
        expect(spyDb).toHaveBeenCalledTimes(2);
    });
});
