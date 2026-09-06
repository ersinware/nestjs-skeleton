/**
 * @file health.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating HealthController status and diagnostics.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_CACHE_HEALTH_PORT, type ICacheHealthPort } from 'src/core/cache';
import type { IDatabaseHealthPort } from 'src/core/database';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database';
import { ResponseHealthyDto } from 'src/module/health/presentation/dto/response-healthy.dto';
import { ResponseUnhealthyDto } from 'src/module/health/presentation/dto/response-unhealthy.dto';
import request from 'supertest';
import { expectDataDto, expectErrorDto } from 'test/shared/dto-assertion.util';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HealthController', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp();
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
            .expect(200)
            .expect((res) => {
                expectDataDto(res.body, ResponseHealthyDto);

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
            .expect(503)
            .expect((res) => {
                expectErrorDto(res.body, ResponseUnhealthyDto);

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
