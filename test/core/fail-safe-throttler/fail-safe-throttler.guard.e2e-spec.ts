/**
 * @file fail-safe-throttler.guard.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating FailSafeThrottlerGuard resilience and environment-based bypass logic.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupCache } from '../../shared/cache.cleaner';
import { createFailSafeThrottlerTestApp as createFailSafeThrottlerGuardTestApp } from './fail-safe-throttler.fixture';

describe('FailSafeThrottlerGuard', () => {
    let app: NestFastifyApplication;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
        await app.close();
    });

    describe('when NODE_ENV is set to "test"', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: 'test',
                limit: 2,
                faultyStorage: false,
            });
            await cleanupCache(app);
        });

        it('should bypass throttler limits entirely and allow requests indefinitely', async () => {
            for (let i = 0; i < 10; i++) {
                await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            }
        });
    });

    describe('when NODE_ENV is set to "production"', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: 'production',
                limit: 2,
                faultyStorage: false,
            });
            await cleanupCache(app);
        });

        it('should enforce throttler limits and block requests with 429 once the limit is exceeded', async () => {
            const server = app.getHttpServer();

            await request(server).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(server).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(server).get('/api/v1/fail-safe-throttler-trigger/test').expect(429);
        });
    });

    describe('when the storage provider fails in a production environment', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: 'production',
                limit: 2,
                faultyStorage: true,
            });
            await cleanupCache(app);
        });

        it('should be fail open and allow requests even if throttler storage throws a connectivity error', async () => {
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);

            expect(console.error).toHaveBeenCalled();
        });
    });
});
