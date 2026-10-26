/**
 * @file target-account-rate-limiting.e2e-spec.ts
 * @description Target-account admission through production endpoints, guards and real Redis counters.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash, randomUUID } from 'node:crypto';
import { CommandPipeline } from 'src/core/cqrs';
import {
    TOKEN_RATE_LIMIT_COUNTER_PORT,
    type IRateLimitCounterPort,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { RATE_LIMIT_POLICIES, RateLimitPolicy } from 'src/core/security/rate-limiting/rate-limit-policy';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Production endpoints whose independent budgets include a target email.
 */
const endpoints = [
    { policy: RateLimitPolicy.USER_LOGIN, url: '/api/v1/auth/user/login', status: 401 },
    { policy: RateLimitPolicy.ADMIN_LOGIN, url: '/api/v1/auth/admin/login', status: 401 },
    { policy: RateLimitPolicy.USER_ACTIVATION_RESEND, url: '/api/v1/user/activation/resend', status: 204 },
] as const;

describe('Target-account policies with production HTTP and Redis', () => {
    let app: NestFastifyApplication;
    let counter: IRateLimitCounterPort;
    const previousTrustProxy = process.env['TRUST_PROXY'];

    beforeAll(async () => {
        process.env['TRUST_PROXY'] = 'false';
        app = await createTestApp();
        counter = app.get(TOKEN_RATE_LIMIT_COUNTER_PORT);
    });

    afterAll(async () => {
        await app?.close();
        if (previousTrustProxy === undefined) {
            delete process.env['TRUST_PROXY'];
        } else {
            process.env['TRUST_PROXY'] = previousTrustProxy;
        }
    });

    it.each(endpoints)(
        'shares $policy account limits across IPs and trimmed inputs for unknown accounts',
        async ({ policy, url, status }) => {
            const email = `${randomUUID()}@example.test`;
            const short = RATE_LIMIT_POLICIES[policy][2];
            for (let i = 0; i < short.limit; i++) {
                const response = await app.inject({
                    method: 'POST',
                    url,
                    remoteAddress: `192.0.2.${i + 1}`,
                    payload: { email: ` ${email} `, ...(status === 401 ? { password: 'Wrong-password-123!' } : {}) },
                });
                expect(response.statusCode).toBe(status);
            }
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            const blocked = await app.inject({
                method: 'POST',
                url,
                remoteAddress: '198.51.100.1',
                payload: { email, ...(status === 401 ? { password: 'Wrong-password-123!' } : {}) },
            });
            expect(blocked.statusCode).toBe(429);
            expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it.each(
        endpoints.flatMap((endpoint) =>
            RATE_LIMIT_POLICIES[endpoint.policy].map((limiter, index) => ({
                ...endpoint,
                limiter,
                index,
            })),
        ),
    )(
        'enforces $policy $limiter.budget independently and stops subsequent effects',
        async ({ policy, url, limiter, index, status }) => {
            const email = `${randomUUID()}@example.test`;
            const ip = '192.0.2.50';
            const tracker =
                limiter.source === RateLimitTrackerSource.IP ? ip : createHash('sha256').update(email).digest('hex');
            // Seed through the production port and real Redis, without modifying configured budgets.
            const attempt = {
                ...limiter,
                key: `${limiter.budget}:${tracker}`,
            };
            for (let i = 0; i < limiter.limit; i++) {
                expect((await counter.consume(attempt)).allowed).toBe(true);
            }
            const consume = vi.spyOn(counter, 'consume');
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            const blocked = await app.inject({
                method: 'POST',
                url,
                remoteAddress: ip,
                payload: { email, ...(status === 401 ? { password: 'Wrong-password-123!' } : {}) },
            });
            expect(blocked.statusCode).toBe(429);
            expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
            expect(consume.mock.calls.map(([input]) => input.key.split(':')[0])).toEqual(
                RATE_LIMIT_POLICIES[policy].slice(0, index + 1).map((limiter) => limiter.budget),
            );
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it.each(
        [
            { policy: RateLimitPolicy.USER_REGISTRATION, url: '/api/v1/user/registration/initiate' },
            { policy: RateLimitPolicy.USER_REGISTRATION, url: '/api/v1/user/registration/complete' },
            { policy: RateLimitPolicy.USER_ACTIVATION, url: '/api/v1/user/activation/complete' },
            { policy: RateLimitPolicy.ADMIN_ACTIVATION, url: '/api/v1/admin/activation/initiate' },
            { policy: RateLimitPolicy.ADMIN_ACTIVATION, url: '/api/v1/admin/activation/complete' },
        ].flatMap((endpoint) =>
            RATE_LIMIT_POLICIES[endpoint.policy].map((limiter, index) => ({ ...endpoint, limiter, index })),
        ),
    )(
        'enforces $limiter.budget on $url without consuming another public workflow budget',
        async ({ policy, url, limiter, index }) => {
            const ip = '192.0.2.90';
            for (let i = 0; i < limiter.limit; i++) {
                expect((await counter.consume({ ...limiter, key: `${limiter.budget}:${ip}` })).allowed).toBe(true);
            }
            const consume = vi.spyOn(counter, 'consume');
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            expect((await app.inject({ method: 'POST', url, remoteAddress: ip, payload: {} })).statusCode).toBe(429);
            expect(consume.mock.calls.map(([attempt]) => attempt.key.split(':')[0])).toEqual(
                RATE_LIMIT_POLICIES[policy].slice(0, index + 1).map((definition) => definition.budget),
            );
            expect(execute).not.toHaveBeenCalled();
            const otherUrl =
                policy === RateLimitPolicy.USER_REGISTRATION
                    ? '/api/v1/admin/activation/initiate'
                    : '/api/v1/user/registration/initiate';
            expect(
                (await app.inject({ method: 'POST', url: otherUrl, remoteAddress: ip, payload: {} })).statusCode,
            ).toBe(400);
        },
    );

    it('shares IP budgets across different accounts without merging their account counters', async () => {
        const { policy, url } = endpoints[0];
        const limit = RATE_LIMIT_POLICIES[policy][0].limit;
        // Invalid passwords reach DTO validation after all counters, avoiding credential work.
        for (let i = 0; i < limit; i++) {
            expect(
                (
                    await app.inject({
                        method: 'POST',
                        url,
                        remoteAddress: '192.0.2.60',
                        payload: { email: `${randomUUID()}@example.test` },
                    })
                ).statusCode,
            ).toBe(400);
        }
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url,
                    remoteAddress: '192.0.2.60',
                    payload: { email: `${randomUUID()}@example.test` },
                })
            ).statusCode,
        ).toBe(429);
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url,
                    remoteAddress: '192.0.2.61',
                    payload: { email: `${randomUUID()}@example.test` },
                })
            ).statusCode,
        ).toBe(400);
    });

    it.each(endpoints)(
        'rejects missing or malformed email in $policy after IP checks without account consumption',
        async ({ policy, url }) => {
            const consume = vi.spyOn(counter, 'consume');
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            for (const payload of [{}, { email: null }, { email: 'bad' }]) {
                consume.mockClear();
                const response = await app.inject({ method: 'POST', url, payload });
                expect(response.statusCode).toBe(400);
                expect(response.json()).toMatchObject({ error: { statusCode: 400 } });
                expect(Array.isArray(response.json<{ error: { message: unknown } }>().error.message)).toBe(true);
                expect(response.headers['retry-after']).toBeUndefined();
                expect(consume.mock.calls.map(([input]) => input.key.split(':')[0])).toEqual(
                    RATE_LIMIT_POLICIES[policy].slice(0, 2).map((limiter) => limiter.budget),
                );
            }
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it('prioritizes an exhausted IP over missing email and never reaches the handler', async () => {
        const { policy, url } = endpoints[0];
        const limiter = RATE_LIMIT_POLICIES[policy][0];
        for (let i = 0; i < limiter.limit; i++) {
            await counter.consume({
                ...limiter,
                key: `${limiter.budget}:192.0.2.70`,
            });
        }
        const consume = vi.spyOn(counter, 'consume');
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        expect((await app.inject({ method: 'POST', url, remoteAddress: '192.0.2.70', payload: {} })).statusCode).toBe(
            429,
        );
        expect(consume).toHaveBeenCalledOnce();
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps login kinds and resend independent for the same email and IP', async () => {
        const email = `${randomUUID()}@example.test`;
        const url = endpoints[2].url;
        expect((await app.inject({ method: 'POST', url, payload: { email } })).statusCode).toBe(204);
        expect((await app.inject({ method: 'POST', url, payload: { email } })).statusCode).toBe(429);
        for (const login of endpoints.slice(0, 2)) {
            expect(
                (
                    await app.inject({
                        method: 'POST',
                        url: login.url,
                        payload: { email, password: 'Wrong-password-123!' },
                    })
                ).statusCode,
            ).toBe(401);
        }
        expect(
            (await app.inject({ method: 'POST', url, payload: { email: `${randomUUID()}@example.test` } })).statusCode,
        ).toBe(204);
    });
});
