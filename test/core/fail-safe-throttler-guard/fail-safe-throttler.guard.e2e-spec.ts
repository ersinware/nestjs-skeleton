/**
 * @file fail-safe-throttler.guard.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating FailSafeThrottlerGuard resilience and environment-based bypass logic.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as Sentry from '@sentry/nestjs';
import { Environment } from 'src/core/config';
import request from 'supertest';
import { createFailSafeThrottlerTestApp as createFailSafeThrottlerGuardTestApp } from 'test/core/fail-safe-throttler-guard/fail-safe-throttler.guard.fixture';
import { cleanupCache } from 'test/shared/cache.cleaner';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

describe('FailSafeThrottlerGuard', () => {
    let app: NestFastifyApplication, mockLoggerPort: { error: MockInstance; warn: MockInstance; log: MockInstance };

    beforeEach(() => {
        mockLoggerPort = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        };
    });

    afterEach(async () => {
        await app.close();
    });

    describe('when NODE_ENV is set to "test"', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: Environment.TEST,
                faultyStorage: false,
                mockLoggerPort,
            });
            await cleanupCache(app);
        });

        it('should bypass throttler limits entirely and allow requests indefinitely', async () => {
            for (let i = 0; i < 10; i++) {
                await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
                await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/critical').expect(200);
            }
        });
    });

    describe('when NODE_ENV is set to "production"', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: Environment.PRODUCTION,
                faultyStorage: false,
                mockLoggerPort,
            });
            await cleanupCache(app);
        });

        it('should enforce default throttler limits and block requests with 429 once the limit is exceeded', async () => {
            const server = app.getHttpServer();

            await request(server).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(server).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(server).get('/api/v1/fail-safe-throttler-trigger/test').expect(429);
        });

        it('should enforce critical throttler limits on decorated routes', async () => {
            const server = app.getHttpServer();

            await request(server).get('/api/v1/fail-safe-throttler-trigger/critical').expect(200);
            await request(server).get('/api/v1/fail-safe-throttler-trigger/critical').expect(429);
        });
    });

    describe('when the storage provider fails in a production environment', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: Environment.PRODUCTION,
                faultyStorage: true,
                mockLoggerPort,
            });
            await cleanupCache(app);
        });

        it('should be fail open and allow requests even if throttler storage throws a connectivity error', async () => {
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);

            const [loggedObject] = mockLoggerPort.error.mock.calls[0] as [{ error: Error }];
            expect(loggedObject.error).toBeInstanceOf(Error);
            expect(Sentry.captureException).toHaveBeenCalled();
        });
    });
});
