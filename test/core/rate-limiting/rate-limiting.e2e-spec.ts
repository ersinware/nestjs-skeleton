/**
 * @file rate-limiting.e2e-spec.ts
 * @description Production guards and real Redis admission, isolation, block TTL and failure recovery.
 */

import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { RedisClientType } from 'redis';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { RateLimitCounterAdapter } from 'src/core/security/rate-limiting/adapter/rate-limit-counter.adapter';
import {
    TOKEN_RATE_LIMIT_COUNTER_PORT,
    type IRateLimitCounterPort,
    type RateLimitCounterAttempt,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { TOKEN_RATE_LIMIT_CONNECTION } from 'src/core/security/rate-limiting/rate-limit-connection.token';
import { RATE_LIMIT_POLICIES } from 'src/core/security/rate-limiting/rate-limit-policy';
import { DependencyUnavailableMessage, RateLimitedMessage } from 'src/shared/exception';
import { RateLimitingTestController } from 'test/core/rate-limiting/rate-limiting.fixture';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Rate limiting with production wiring and real Redis', () => {
    let app: NestFastifyApplication;
    const originalShort = { ...RATE_LIMIT_POLICIES.default[0] };
    const originalLong = { ...RATE_LIMIT_POLICIES.default[1] };
    const previousTrustProxy = process.env['TRUST_PROXY'];
    const report = vi.fn();

    beforeEach(async () => {
        // Only budgets change; guards, module lifecycle, algorithm and Redis stay real.
        Object.assign(RATE_LIMIT_POLICIES.default[0], { limit: 2 });
        Object.assign(RATE_LIMIT_POLICIES.default[1], { limit: 100 });
        process.env['TRUST_PROXY'] = 'false';
        app = await createTestApp({
            extraControllers: [RateLimitingTestController],
            overrides: [{ provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report } }],
        });
    });

    afterEach(async () => {
        await app?.close();
        Object.assign(RATE_LIMIT_POLICIES.default[0], originalShort);
        Object.assign(RATE_LIMIT_POLICIES.default[1], originalLong);
        if (previousTrustProxy === undefined) {
            delete process.env['TRUST_PROXY'];
        } else {
            process.env['TRUST_PROXY'] = previousTrustProxy;
        }
    });

    it('shares budgets across endpoints, ignores spoofed forwarding headers, and returns the documented 429 contract', async () => {
        expect((await app.inject({ url: '/api/v1/rate-limit-test/a' })).statusCode).toBe(200);
        expect(
            (await app.inject({ url: '/api/v1/rate-limit-test/b', headers: { 'x-forwarded-for': '192.0.2.1' } }))
                .statusCode,
        ).toBe(200);
        const blocked = await app.inject({
            url: '/api/v1/rate-limit-test/a',
            headers: { 'x-forwarded-for': '192.0.2.2' },
        });
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toEqual({
            error: { statusCode: 429, statusText: 'Too Many Requests', message: [RateLimitedMessage.DEFAULT] },
        });
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(blocked.headers['cache-control']).toBe('no-store');
        expect(Object.keys(blocked.headers).some((name) => /^(x-)?ratelimit/i.test(name))).toBe(false);
        expect(app.get(RateLimitingTestController).calls).toBe(2);
        expect(report).not.toHaveBeenCalled();
        expect((await app.inject({ url: '/api/v1/rate-limit-test/refresh' })).statusCode).toBe(200);
    });

    it('consumes pre-auth budget on unauthorized requests and blocks before authentication on exhaustion', async () => {
        for (let i = 0; i < 2; i++) {
            expect((await app.inject({ url: '/api/v1/rate-limit-test/protected' })).statusCode).toBe(401);
        }
        expect((await app.inject({ url: '/api/v1/rate-limit-test/protected' })).statusCode).toBe(429);
        expect(app.get(RateLimitingTestController).calls).toBe(0);
    });

    it('enforces the long limiter independently and returns its block duration', async () => {
        Object.assign(RATE_LIMIT_POLICIES.default[0], { limit: 100 });
        Object.assign(RATE_LIMIT_POLICIES.default[1], { limit: 1 });
        const url = '/api/v1/rate-limit-test/a';
        expect((await app.inject({ url })).statusCode).toBe(200);
        const blocked = await app.inject({ url });
        expect(blocked.statusCode).toBe(429);
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(10);
        expect(app.get(RateLimitingTestController).calls).toBe(1);
    });

    it.each([0, 1])('shares default IP counter %i with job queue mutations', async (index) => {
        const limiter = RATE_LIMIT_POLICIES.default[index]!;
        const counter = app.get<IRateLimitCounterPort>(TOKEN_RATE_LIMIT_COUNTER_PORT);
        const ip = '192.0.2.91';
        for (let i = 0; i < limiter.limit; i++) {
            expect((await counter.consume({ ...limiter, key: `${limiter.budget}:${ip}` })).allowed).toBe(true);
        }
        for (const action of ['redrive', 'discard']) {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/job-operations/dead-letter/${action}`,
                remoteAddress: ip,
                payload: {},
            });
            expect(response.statusCode).toBe(429);
        }
    });

    it('keeps full IPv6 addresses distinct while sharing canonical equivalent representations', async () => {
        const url = '/api/v1/rate-limit-test/a';
        expect((await app.inject({ url, remoteAddress: '2001:db8::1' })).statusCode).toBe(200);
        expect((await app.inject({ url, remoteAddress: '2001:0db8:0:0:0:0:0:1' })).statusCode).toBe(200);
        expect((await app.inject({ url, remoteAddress: '2001:db8::1' })).statusCode).toBe(429);
        expect((await app.inject({ url, remoteAddress: '2001:db8::2' })).statusCode).toBe(200);
    });

    it('honors a trusted proxy chain and separates the forwarded client IPs', async () => {
        await app.close();
        process.env['TRUST_PROXY'] = '127.0.0.1,::1';
        app = await createTestApp({ extraControllers: [RateLimitingTestController] });
        const url = '/api/v1/rate-limit-test/a';
        for (let i = 0; i < 2; i++) {
            expect((await app.inject({ url, headers: { 'x-forwarded-for': '192.0.2.1' } })).statusCode).toBe(200);
        }
        expect((await app.inject({ url, headers: { 'x-forwarded-for': '192.0.2.1' } })).statusCode).toBe(429);
        expect((await app.inject({ url, headers: { 'x-forwarded-for': '192.0.2.2' } })).statusCode).toBe(200);
    });

    it('fails closed on rate-store disconnection, keeps probes exempt, and recovers without changing their health contract', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        redis.destroy();
        const response = await app.inject({ url: '/api/v1/rate-limit-test/a' });
        expect(response.statusCode).toBe(503);
        expect(
            response.json<{
                error: {
                    message: string[];
                };
            }>().error.message,
        ).toEqual([DependencyUnavailableMessage.DEFAULT]);
        expect(response.headers['retry-after']).toBeUndefined();
        expect((await app.inject({ url: '/api/health/live' })).statusCode).toBe(204);
        expect((await app.inject({ url: '/api/health/ready' })).statusCode).toBe(503);
        expect(app.get(RateLimitingTestController).calls).toBe(0);
        expect(report).not.toHaveBeenCalled();
        await redis.connect();
        expect((await app.inject({ url: '/api/v1/rate-limit-test/a' })).statusCode).toBe(200);
        expect((await app.inject({ url: '/api/health/ready' })).statusCode).toBe(204);
    });

    it('isolates separate application namespaces without flushing shared Redis', async () => {
        const second = await createTestApp({ extraControllers: [RateLimitingTestController] });
        try {
            const url = '/api/v1/rate-limit-test/a';
            await app.inject({ url });
            await app.inject({ url });
            expect((await app.inject({ url })).statusCode).toBe(429);
            expect((await second.inject({ url })).statusCode).toBe(200);
        } finally {
            await second.close();
        }
    });

    it('admits only the configured number of concurrent requests across application connections sharing one key', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        const config = app.get(ConfigService);
        const first = new RateLimitCounterAdapter(redis, config);
        const secondApp = await createTestApp();
        const second = new RateLimitCounterAdapter(secondApp.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION), config);
        const attempt = {
            key: `api:rl:concurrency:ip-short:${randomUUID()}`,

            limit: 3,
            windowSeconds: 60,
            blockDurationSeconds: 1,
        };
        try {
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).consume(attempt)),
            );
            expect(results.filter((result) => result.allowed)).toHaveLength(3);
            expect(results.filter((result) => !result.allowed)).toHaveLength(17);
        } finally {
            await secondApp.close();
        }
    });

    it('isolates identical logical keys by service and environment while sharing between replicas', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        const service = `namespace-${randomUUID()}`;
        const make = (environment: string, name: string): RateLimitCounterAdapter =>
            new RateLimitCounterAdapter(
                redis,
                new ConfigService({ NODE_ENV: environment, SERVICE_NAME: name, REDIS_RATE_LIMIT_COMMAND_TIMEOUT: 1 }),
            );
        const first = make('test', service);
        const replica = make('test', service);
        const otherService = make('test', `${service}-other`);
        const otherEnvironment = make('production', service);
        const attempt = { key: `namespace:${randomUUID()}`, limit: 1, windowSeconds: 60, blockDurationSeconds: 60 };
        expect((await first.consume(attempt)).allowed).toBe(true);
        expect((await replica.consume(attempt)).allowed).toBe(false);
        expect((await otherService.consume(attempt)).allowed).toBe(true);
        expect((await otherEnvironment.consume(attempt)).allowed).toBe(true);
        const keys = await redis.keys(`*${attempt.key}*`);
        expect(keys.some((key) => key.includes(`:test:${service}:rate-limit`))).toBe(true);
        expect(keys.some((key) => key.includes(`:production:${service}:rate-limit`))).toBe(true);
    });

    it('retains counts across limit changes and preserves an already active block', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        const adapter = new RateLimitCounterAdapter(redis, app.get(ConfigService));
        const id = randomUUID();
        const attempt = {
            key: `api:rl:config-change:ip-short:${id}`,

            limit: 2,
            windowSeconds: 60,
            blockDurationSeconds: 1,
        };
        expect((await adapter.consume(attempt)).allowed).toBe(true);
        expect((await adapter.consume({ ...attempt, limit: 1 })).allowed).toBe(false);
        const blockKey = (await redis.keys(`*${id}*`)).find((key) => key.endsWith(':block'))!;
        const before = await redis.pTTL(blockKey);
        expect((await adapter.consume({ ...attempt, limit: 100, blockDurationSeconds: 30 })).allowed).toBe(false);
        expect(await redis.pTTL(blockKey)).toBeLessThanOrEqual(before);
    });

    it('recovers from a lost server script cache without counting the failed NOSCRIPT attempt', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        const adapter = new RateLimitCounterAdapter(redis, app.get(ConfigService));
        const attempt = {
            key: `api:rl:script-recovery:ip-short:${randomUUID()}`,

            limit: 2,
            windowSeconds: 60,
            blockDurationSeconds: 1,
        };
        expect((await adapter.consume(attempt)).allowed).toBe(true);
        // Fault injection on the workflow-owned rate Redis; no counter data is removed.
        await redis.scriptFlush();
        expect((await adapter.consume(attempt)).allowed).toBe(true);
        expect((await adapter.consume(attempt)).allowed).toBe(false);
    });

    it('bounds a real Redis response wait while allowing the already sent mutation to finish', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        const adapter = new RateLimitCounterAdapter(
            redis,
            new ConfigService({
                REDIS_RATE_LIMIT_COMMAND_TIMEOUT: 0.05,
                NODE_ENV: 'test',
                SERVICE_NAME: 'timeout-test',
            }),
        );
        const attempt = {
            key: `api:rl:timeout:ip-short:${randomUUID()}`,

            limit: 1,
            windowSeconds: 60,
            blockDurationSeconds: 1,
        };
        // Warm the package script cache before fault injection.
        await adapter.consume({ ...attempt, key: `${attempt.key}-warm` });
        await redis.sendCommand(['CLIENT', 'PAUSE', '500', 'ALL']);
        await expect(adapter.consume(attempt)).rejects.toMatchObject({ kind: 'DEPENDENCY_UNAVAILABLE' });
        await redis.ping();
        // The timed-out command was sent once and can still consume budget on the server.
        expect((await adapter.consume(attempt)).allowed).toBe(false);
    });

    it('does not extend active blocks and expires counter keys after two windows', async () => {
        const redis = app.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION);
        const counter = app.get<IRateLimitCounterPort>(TOKEN_RATE_LIMIT_COUNTER_PORT);
        const id = randomUUID();
        const attempt: RateLimitCounterAttempt = {
            key: `api:rl:expiry:ip-short:${id}`,

            limit: 1,
            windowSeconds: 1,
            blockDurationSeconds: 1,
        };
        // A request crossing a fixed-window boundary can admit one weighted carry-over hit.
        // Fill until blocked so this expiry test does not depend on the server's wall-clock phase.
        let result = await counter.consume(attempt);
        for (let i = 0; result.allowed && i < 3; i++) {
            result = await counter.consume(attempt);
        }
        expect(result.allowed).toBe(false);
        const keys = await redis.keys(`*${id}*`);
        const blockKey = keys.find((key) => key.endsWith(':block'))!;
        const before = await redis.pTTL(blockKey);
        await delay(150);
        await counter.consume(attempt);
        expect(await redis.pTTL(blockKey)).toBeLessThan(before - 50);
        await delay(2100);
        expect(await redis.keys(`*${id}*`)).toEqual([]);
        expect((await counter.consume(attempt)).allowed).toBe(true);
    });
});

describe('Rate-limit test isolation with a reused application', () => {
    let app: NestFastifyApplication;
    const attempt: RateLimitCounterAttempt = {
        key: `api:rl:case-isolation:ip-short:${randomUUID()}`,

        limit: 1,
        windowSeconds: 60,
        blockDurationSeconds: 60,
    };

    beforeAll(async () => {
        app = await createTestApp();
    });
    afterAll(async () => {
        await app?.close();
    });

    it.each(['first case', 'second case'])(
        'keeps %s independent while enforcing repeated requests inside it',
        async () => {
            const counter = app.get<IRateLimitCounterPort>(TOKEN_RATE_LIMIT_COUNTER_PORT);
            expect((await counter.consume(attempt)).allowed).toBe(true);
            expect((await counter.consume(attempt)).allowed).toBe(false);
        },
    );
});
