/**
 * @file fail-safe-throttler.guard.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating FailSafeThrottlerGuard resilience and environment-based bypass logic.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi, MockInstance } from 'vitest';
import { Environment } from 'src/common/enum/config/environment.enum';
import { cleanupCache } from '../../shared/cache.cleaner';
import { createFailSafeThrottlerTestApp as createFailSafeThrottlerGuardTestApp } from './fail-safe-throttler.guard.fixture';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));
import * as Sentry from '@sentry/nestjs';

describe('FailSafeThrottlerGuard', () => {
    let app: NestFastifyApplication, mockLogger: { error: MockInstance };

    beforeEach(() => {
        mockLogger = {
            error: vi.fn(),
        };
    });

    afterEach(async () => {
        await app.close();
    });

    describe('when NODE_ENV is set to "test"', () => {
        beforeEach(async () => {
            app = await createFailSafeThrottlerGuardTestApp({
                nodeEnv: Environment.TEST,
                limit: 2,
                faultyStorage: false,
                mockLogger,
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
                nodeEnv: Environment.PRODUCTION,
                limit: 2,
                faultyStorage: false,
                mockLogger,
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
                nodeEnv: Environment.PRODUCTION,
                limit: 2,
                faultyStorage: true,
                mockLogger,
            });
            await cleanupCache(app);
        });

        it('should be fail open and allow requests even if throttler storage throws a connectivity error', async () => {
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);
            await request(app.getHttpServer()).get('/api/v1/fail-safe-throttler-trigger/test').expect(200);

            const [loggedObject] = mockLogger.error.mock.calls[0] as [{ error: Error }];
            expect(loggedObject.error).toBeInstanceOf(Error);
            expect(Sentry.captureException).toHaveBeenCalled();
        });
    });
});
