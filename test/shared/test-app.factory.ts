/**
 * @file test-app.factory.ts
 * @description E2E application factory.
 */

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { RedisClientType } from 'redis';
import { AppModule } from 'src/app.module';
import { resolveTrustProxy } from 'src/core/config';
import { httpCacheHook } from 'src/core/http';
import { auditContextHook } from 'src/core/observability/audit';
import { RateLimitCounterAdapter } from 'src/core/security/rate-limiting/adapter/rate-limit-counter.adapter';
import {
    TOKEN_RATE_LIMIT_COUNTER_PORT,
    type IRateLimitCounterPort,
    type RateLimitCounterAttempt,
    type RateLimitCounterResult,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { TOKEN_RATE_LIMIT_CONNECTION } from 'src/core/security/rate-limiting/rate-limit-connection.token';
import { TOKEN_STORAGE_PORT } from 'src/core/storage';
import type { OptionsTestApp } from 'test/shared/interface/e2e-spec.interface';
import { TestRunner } from 'vitest';

/**
 * Initializes the application with E2E routing and provider overrides.
 *
 * @param options Optional controllers and provider overrides.
 * @returns An initialized Fastify application.
 */
export async function createTestApp(options?: OptionsTestApp): Promise<NestFastifyApplication> {
    const builder = Test.createTestingModule({
        imports: [AppModule],
        controllers: [...(options?.extraControllers ?? [])],
    });

    // Isolate apps and test cases, including apps reused through beforeAll.
    // Requests within one test retain the production budgets and real Redis adapter.
    const namespace = `api-test-${randomUUID()}`;
    builder.overrideProvider(TOKEN_RATE_LIMIT_COUNTER_PORT).useFactory({
        inject: [TOKEN_RATE_LIMIT_CONNECTION, ConfigService],
        factory: (redis: RedisClientType, configService: ConfigService): IRateLimitCounterPort => {
            const counter = new RateLimitCounterAdapter(redis, configService);
            return {
                consume: (attempt: RateLimitCounterAttempt): Promise<RateLimitCounterResult> =>
                    counter.consume({
                        ...attempt,
                        key: `${namespace}-${TestRunner.getCurrentTest()?.id ?? 'bootstrap'}${attempt.key.slice(attempt.key.indexOf(':'))}`,
                    }),
            };
        },
    });

    // Fail on unexpected storage use in E2E tests that do not provision S3.
    builder.overrideProvider(TOKEN_STORAGE_PORT).useValue({});

    (options?.overrides ?? []).forEach((override) => {
        builder.overrideProvider(override.provide).useValue(override.useValue);
    });

    const app = (await builder.compile()).createNestApplication<NestFastifyApplication>(
        new FastifyAdapter({ trustProxy: resolveTrustProxy() }),
    );

    app.getHttpAdapter().getInstance().addHook('onRequest', auditContextHook);
    app.getHttpAdapter().getInstance().addHook('onSend', httpCacheHook);

    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.enableShutdownHooks();

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Runtime bootstrap is fail-closed while connecting; fixtures wait for their provisioned store.
    const rateLimitRedis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
    if (!rateLimitRedis.isReady) {
        try {
            await once(rateLimitRedis, 'ready', { signal: AbortSignal.timeout(5000) });
        } catch (error) {
            await app.close();
            throw error;
        }
    }

    return app;
}
