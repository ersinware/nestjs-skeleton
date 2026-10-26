/**
 * @file principal-rate-limiting.e2e-spec.ts
 * @description Verified-principal budgets through real authentication, sessions and Redis counters.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import type { RedisClientType } from 'redis';
import { CommandPipeline } from 'src/core/cqrs';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { audit } from 'src/core/observability/audit/audit.schema';
import {
    TOKEN_RATE_LIMIT_COUNTER_PORT,
    type IRateLimitCounterPort,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { TOKEN_RATE_LIMIT_CONNECTION } from 'src/core/security/rate-limiting/rate-limit-connection.token';
import { RATE_LIMIT_POLICIES, RateLimitPolicy } from 'src/core/security/rate-limiting/rate-limit-policy';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { Permission, PrincipalType, type Principal } from 'src/shared/domain/principal';
import { PrincipalRateLimitingTestController } from 'test/core/rate-limiting/principal-rate-limiting.fixture';
import { createTestApp } from 'test/shared/test-app.factory';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Real endpoints sharing the three principal policies.
 */
const groups = [
    {
        policy: RateLimitPolicy.CREDENTIAL_CHANGE,
        fixture: 'password',
        endpoints: [
            { method: 'PATCH', url: '/api/v1/user/me/password', kind: PrincipalType.USER },
            { method: 'POST', url: '/api/v1/user/me/email/initiate', kind: PrincipalType.USER },
            { method: 'PATCH', url: '/api/v1/admin/me/password', kind: PrincipalType.ADMIN },
            { method: 'POST', url: '/api/v1/admin/me/email/initiate', kind: PrincipalType.ADMIN },
        ],
    },
    {
        policy: RateLimitPolicy.ADMIN_INVITATION,
        fixture: 'invitation',
        endpoints: [{ method: 'POST', url: '/api/v1/admin/invite', kind: PrincipalType.ADMIN }],
    },
    {
        policy: RateLimitPolicy.AVATAR_UPLOAD_INITIATE,
        fixture: 'avatar',
        endpoints: [
            { method: 'POST', url: '/api/v1/user/me/avatar/initiate', kind: PrincipalType.USER },
            { method: 'POST', url: '/api/v1/admin/me/avatar/initiate', kind: PrincipalType.ADMIN },
        ],
    },
] as const;

describe('Principal policies with production guards and Redis', () => {
    let app: NestFastifyApplication;
    let counter: IRateLimitCounterPort;
    let tokens: ITokenPort;
    let sessions: ISessionPort;
    const ids: string[] = [];

    beforeAll(async () => {
        app = await createTestApp({ extraControllers: [PrincipalRateLimitingTestController] });
        counter = app.get(TOKEN_RATE_LIMIT_COUNTER_PORT);
        tokens = app.get(TOKEN_TOKEN_PORT);
        sessions = app.get(TOKEN_SESSION_PORT);
    });

    afterAll(async () => {
        if (!app) {
            return;
        }
        try {
            if (ids.length) {
                await app.get<NodePgDatabase>(TOKEN_DATABASE_CLIENT).delete(audit).where(inArray(audit.actorId, ids));
            }
            const redis = app.get<Redis>(TOKEN_SESSION_CONNECTION);
            for (const id of ids) {
                let cursor = '0';
                do {
                    const [next, keys] = await redis.scan(cursor, 'MATCH', `auth:{${id}}:*`, 'COUNT', 100);
                    cursor = next;
                    if (keys.length) {
                        await redis.del(...keys);
                    }
                } while (cursor !== '0');
            }
        } finally {
            await app.close();
        }
    });

    /**
     * Registers genuine session state and signed credentials without bypassing authentication.
     *
     * @param kind Owning principal context.
     * @param id Existing identity when testing multiple sessions for one caller.
     * @param permissions Verified permission assignments for authorization.
     * @returns Caller identity and signed credentials backed by a live session.
     */
    async function caller(
        kind = PrincipalType.ADMIN,
        id = uuidv7(),
        permissions: readonly Permission[] = kind === PrincipalType.ADMIN ? [Permission.ADMIN_ACCOUNT_INVITE] : [],
    ): Promise<Awaited<ReturnType<ITokenPort['generateTokens']>> & Principal> {
        ids.push(id);
        const pair = await tokens.generateTokens({ id, type: kind, permissions }, 0);
        expect(await sessions.openSession(id, pair.session)).toBe(true);
        return { id, type: kind, permissions, ...pair };
    }

    it.each(groups.flatMap((group) => group.endpoints.map((endpoint) => ({ ...endpoint, policy: group.policy }))))(
        'maps $method $url to exactly the selected post-auth counters',
        async ({ method, url, kind, policy }) => {
            const account = await caller(kind);
            const consume = vi.spyOn(counter, 'consume');
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            const response = await app.inject({
                method,
                url,
                headers: { authorization: `Bearer ${account.accessToken}` },
                payload: {},
            });
            // Valid credentials reach DTO validation, without executing any workflow.
            expect(response.statusCode).toBe(400);
            const selectedPolicy = url.endsWith('/re-invite') ? RateLimitPolicy.ADMIN_REINVITATION : policy;
            expect(consume.mock.calls.map(([attempt]) => attempt.key)).toEqual(
                RATE_LIMIT_POLICIES[selectedPolicy].map(
                    (limiter) =>
                        `${limiter.budget}:${limiter.source === RateLimitTrackerSource.IP ? '127.0.0.1' : limiter.source === RateLimitTrackerSource.TARGET_ACCOUNT ? url.split('/')[4] : account.id}`,
                ),
            );
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it.each(
        groups.flatMap((group) =>
            RATE_LIMIT_POLICIES[group.policy]
                .filter((limiter) => limiter.source === RateLimitTrackerSource.PRINCIPAL)
                .map((limiter, index) => ({
                    ...group,
                    limiter,
                    index,
                })),
        ),
    )(
        'enforces $policy $limiter.budget independently before any workflow',
        async ({ policy, endpoints, limiter, index }) => {
            const endpoint = endpoints[0];
            const account = await caller(endpoint.kind);
            for (let i = 0; i < limiter.limit; i++) {
                expect(
                    (
                        await counter.consume({
                            ...limiter,
                            key: `${limiter.budget}:${account.id}`,
                        })
                    ).allowed,
                ).toBe(true);
            }
            const consume = vi.spyOn(counter, 'consume');
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            const response = await app.inject({
                method: endpoint.method,
                url: endpoint.url,
                headers: { authorization: `Bearer ${account.accessToken}` },
                payload: {},
            });
            expect(response.statusCode).toBe(429);
            expect(response.json()).toMatchObject({ error: { statusCode: 429 } });
            expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
            expect(response.headers['cache-control']).toBe('no-store');
            expect(consume.mock.calls.map(([attempt]) => attempt.key.split(':')[0])).toEqual(
                RATE_LIMIT_POLICIES[policy].slice(0, index + 3).map((limiter) => limiter.budget),
            );
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it.each(groups)(
        'shares $policy across IPs, sessions and endpoints while separating callers',
        async ({ policy, endpoints, fixture }) => {
            const account = await caller(endpoints[0].kind);
            const otherSession = await caller(account.type, account.id);
            const otherCaller = await caller(account.type);
            const limit = RATE_LIMIT_POLICIES[policy].find(
                (limiter) => limiter.source === RateLimitTrackerSource.PRINCIPAL,
            )!.limit;
            for (let i = 0; i < limit; i++) {
                const matching = endpoints.filter((endpoint) => endpoint.kind === account.type);
                const endpoint = matching[i % matching.length]!;
                // Invalid payload or route parameters reject after admission, before workflow effects.
                const response = await app.inject({
                    method: endpoint.method,
                    url: endpoint.url,
                    remoteAddress: `192.0.2.${i + 1}`,
                    headers: { authorization: `Bearer ${i % 2 ? otherSession.accessToken : account.accessToken}` },
                    payload: {},
                });
                expect(response.statusCode).toBe(400);
            }
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            expect(
                (
                    await app.inject({
                        url: `/api/v1/principal-rate-limit-test/${fixture}`,
                        remoteAddress: '198.51.100.1',
                        headers: { authorization: `Bearer ${otherSession.accessToken}` },
                    })
                ).statusCode,
            ).toBe(429);
            expect(execute).not.toHaveBeenCalled();
            expect(
                (
                    await app.inject({
                        url: `/api/v1/principal-rate-limit-test/${fixture}`,
                        headers: { authorization: `Bearer ${otherCaller.accessToken}` },
                    })
                ).statusCode,
            ).toBe(200);
        },
    );

    it.each(groups)(
        'keeps $policy success consumption instead of resetting the budget',
        async ({ policy, fixture }) => {
            const account = await caller();
            const controller = app.get(PrincipalRateLimitingTestController);
            const initialCalls = controller.calls;
            const request = {
                url: `/api/v1/principal-rate-limit-test/${fixture}`,
                headers: { authorization: `Bearer ${account.accessToken}` },
            };
            for (
                let i = 0;
                i <
                RATE_LIMIT_POLICIES[policy].find((limiter) => limiter.source === RateLimitTrackerSource.PRINCIPAL)!
                    .limit;
                i++
            ) {
                expect((await app.inject(request)).statusCode).toBe(200);
            }
            expect((await app.inject(request)).statusCode).toBe(429);
            expect(controller.calls - initialCalls).toBe(
                RATE_LIMIT_POLICIES[policy].find((limiter) => limiter.source === RateLimitTrackerSource.PRINCIPAL)!
                    .limit,
            );
        },
    );

    it.each(groups)(
        'consumes only pre-auth IP budgets for absent, invalid, or closed-session credentials in $policy',
        async ({ endpoints }) => {
            const endpoint = endpoints[0];
            const account = await caller(endpoint.kind);
            await sessions.closeSession(account.id, account.type, account.session.sid);
            const consume = vi.spyOn(counter, 'consume');
            const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
            for (const authorization of [undefined, 'Bearer invalid', `Bearer ${account.accessToken}`]) {
                const response = await app.inject({
                    method: endpoint.method,
                    url: endpoint.url,
                    headers: { ...(authorization ? { authorization } : {}) },
                    payload: {},
                });
                expect(response.statusCode).toBe(401);
            }
            expect(consume.mock.calls).toHaveLength(6);
            expect(consume.mock.calls.every(([attempt]) => attempt.key.includes('-ip-'))).toBe(true);
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it('preserves invitation consumption after authorization rejection and tracks the caller instead of the target', async () => {
        const account = await caller(PrincipalType.ADMIN, uuidv7(), []);
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        const consume = vi.spyOn(counter, 'consume');
        for (let i = 0; i < RATE_LIMIT_POLICIES[RateLimitPolicy.ADMIN_INVITATION][2].limit; i++) {
            expect(
                (
                    await app.inject({
                        method: 'POST',
                        url: `/api/v1/admin/${uuidv7()}/re-invite`,
                        headers: { authorization: `Bearer ${account.accessToken}` },
                    })
                ).statusCode,
            ).toBe(403);
        }
        expect(
            consume.mock.calls
                .filter(([attempt]) => !attempt.key.includes('-ip-') && !attempt.key.includes('-target-'))
                .every(([attempt]) => attempt.key.endsWith(`:${account.id}`)),
        ).toBe(true);
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/admin/invite',
                    headers: { authorization: `Bearer ${account.accessToken}` },
                    payload: {},
                })
            ).statusCode,
        ).toBe(429);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each([0, 1])('shares invitation IP counter %i with re-invitations before authentication', async (index) => {
        const limiter = RATE_LIMIT_POLICIES[RateLimitPolicy.ADMIN_INVITATION][index]!;
        const ip = '192.0.2.92';
        for (let i = 0; i < limiter.limit; i++) {
            expect((await counter.consume({ ...limiter, key: `${limiter.budget}:${ip}` })).allowed).toBe(true);
        }
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        expect(
            (await app.inject({ method: 'POST', url: `/api/v1/admin/${uuidv7()}/re-invite`, remoteAddress: ip }))
                .statusCode,
        ).toBe(429);
        expect(execute).not.toHaveBeenCalled();
    });

    it('enforces the long job mutation budget independently', async () => {
        const account = await caller(PrincipalType.ADMIN, uuidv7(), []);
        const limiter = RATE_LIMIT_POLICIES[RateLimitPolicy.JOB_QUEUE_MUTATION][3];
        for (let i = 0; i < limiter.limit; i++) {
            expect((await counter.consume({ ...limiter, key: `${limiter.budget}:${account.id}` })).allowed).toBe(true);
        }
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/job-operations/dead-letter/discard',
            headers: { authorization: `Bearer ${account.accessToken}` },
            payload: {},
        });
        expect(response.statusCode).toBe(429);
        expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(
        RATE_LIMIT_POLICIES[RateLimitPolicy.ADMIN_REINVITATION].filter(
            (limiter) => limiter.source === RateLimitTrackerSource.TARGET_ACCOUNT,
        ),
    )('enforces re-invitation $budget across callers and canonical UUID spellings', async (limiter) => {
        const target = uuidv7();
        const account = await caller(PrincipalType.ADMIN, uuidv7(), []);
        for (let i = 0; i < limiter.limit; i++) {
            expect((await counter.consume({ ...limiter, key: `${limiter.budget}:${target}` })).allowed).toBe(true);
        }
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/admin/${target.toUpperCase()}/re-invite`,
            headers: { authorization: `Bearer ${account.accessToken}` },
        });
        expect(response.statusCode).toBe(429);
        expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(execute).not.toHaveBeenCalled();
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: `/api/v1/admin/${uuidv7()}/re-invite`,
                    headers: { authorization: `Bearer ${account.accessToken}` },
                })
            ).statusCode,
        ).toBe(403);
    });

    it('rejects discard batches above 100 before workflow execution', async () => {
        const account = await caller(PrincipalType.ADMIN, uuidv7(), [Permission.JOB_DEAD_LETTER_DISCARD]);
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/job-operations/dead-letter/discard',
            headers: { authorization: `Bearer ${account.accessToken}` },
            payload: { jobIds: Array.from({ length: 101 }, () => uuidv7()) },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { statusCode: 400 } });
        expect(execute).not.toHaveBeenCalled();
    });

    it('validates re-invitation targets only after authentication and before authorization', async () => {
        const account = await caller(PrincipalType.ADMIN, uuidv7(), []);
        const consume = vi.spyOn(counter, 'consume');
        const url = '/api/v1/admin/invalid/re-invite';
        expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
        expect(consume).toHaveBeenCalledTimes(2);
        consume.mockClear();
        expect(
            (await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${account.accessToken}` } }))
                .statusCode,
        ).toBe(400);
        expect(consume).toHaveBeenCalledTimes(2);
        expect(consume.mock.calls.every(([attempt]) => attempt.key.includes('-ip-'))).toBe(true);
    });

    it('shares job mutation caller budgets between redrive and discard before workflow effects', async () => {
        const account = await caller(PrincipalType.ADMIN, uuidv7(), []);
        const headers = { authorization: `Bearer ${account.accessToken}` };
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        for (const action of ['redrive', 'discard', 'redrive']) {
            expect(
                (
                    await app.inject({
                        method: 'POST',
                        url: `/api/v1/job-operations/dead-letter/${action}`,
                        headers,
                        payload: {},
                    })
                ).statusCode,
            ).toBe(403);
        }
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/job-operations/dead-letter/discard',
                    headers,
                    payload: {},
                })
            ).statusCode,
        ).toBe(429);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each([
        { kind: PrincipalType.USER, url: '/api/v1/admin/me/avatar/initiate' },
        { kind: PrincipalType.ADMIN, url: '/api/v1/user/me/avatar/initiate' },
    ])('consumes the caller budget before principal-kind authorization at $url', async ({ kind, url }) => {
        const account = await caller(kind);
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        for (let i = 0; i < RATE_LIMIT_POLICIES[RateLimitPolicy.AVATAR_UPLOAD_INITIATE][2].limit; i++) {
            expect(
                (
                    await app.inject({
                        method: 'POST',
                        url,
                        headers: { authorization: `Bearer ${account.accessToken}` },
                        payload: {},
                    })
                ).statusCode,
            ).toBe(403);
        }
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url,
                    headers: { authorization: `Bearer ${account.accessToken}` },
                    payload: {},
                })
            ).statusCode,
        ).toBe(429);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each([
        { method: 'PATCH', url: '/api/v1/user/me' },
        { method: 'PATCH', url: '/api/v1/admin/me' },
        { method: 'POST', url: '/api/v1/user/me/email/confirm' },
        { method: 'POST', url: '/api/v1/admin/me/email/confirm' },
        { method: 'POST', url: '/api/v1/auth/logout' },
        { method: 'POST', url: '/api/v1/auth/logout-all' },
    ] as const)('retains default IP limiting at $method $url', async ({ method, url }) => {
        const consume = vi.spyOn(counter, 'consume');
        const execute = vi.spyOn(app.get(CommandPipeline), 'execute');
        const response = await app.inject({
            method,
            url,
            remoteAddress: '192.0.2.80',
            payload: { unexpected: true },
        });
        expect(response.statusCode).toBe(url.endsWith('/logout') ? 400 : 401);
        expect(consume.mock.calls.map(([attempt]) => attempt.key)).toEqual([
            `default-ip-short:192.0.2.80`,
            `default-ip-long:192.0.2.80`,
        ]);
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps the three principal policies independent for the same caller', async () => {
        const account = await caller();
        const headers = { authorization: `Bearer ${account.accessToken}` };
        for (let i = 0; i < RATE_LIMIT_POLICIES[RateLimitPolicy.ADMIN_INVITATION][2].limit; i++) {
            expect(
                (await app.inject({ url: '/api/v1/principal-rate-limit-test/invitation', headers })).statusCode,
            ).toBe(200);
        }
        expect((await app.inject({ url: '/api/v1/principal-rate-limit-test/invitation', headers })).statusCode).toBe(
            429,
        );
        expect((await app.inject({ url: '/api/v1/principal-rate-limit-test/password', headers })).statusCode).toBe(200);
        expect((await app.inject({ url: '/api/v1/principal-rate-limit-test/avatar', headers })).statusCode).toBe(200);
    });

    it('fails closed on rate-limit Redis loss before authentication and workflow execution', async () => {
        const isolated = await createTestApp();
        try {
            const account = await caller(PrincipalType.USER);
            isolated.get<RedisClientType>(TOKEN_RATE_LIMIT_CONNECTION).destroy();
            const execute = vi.spyOn(isolated.get(CommandPipeline), 'execute');
            const url = '/api/v1/user/me/avatar/initiate';
            expect((await isolated.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(503);
            const response = await isolated.inject({
                method: 'POST',
                url,
                headers: { authorization: `Bearer ${account.accessToken}` },
                payload: {},
            });
            expect(response.statusCode).toBe(503);
            expect(response.headers['retry-after']).toBeUndefined();
            expect(execute).not.toHaveBeenCalled();
        } finally {
            await isolated.close();
        }
    });
});
