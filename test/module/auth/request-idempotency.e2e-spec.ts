/**
 * @file request-idempotency.e2e-spec.ts
 * @description Exercises login and refresh retries through production HTTP, JWT, Redis, and durable evidence.
 */

import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { ENV, parseTtlToSeconds } from 'src/core/config';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { audit } from 'src/core/observability/audit';
import {
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    TOKEN_AUTH_ACCESS_TOKEN_PORT,
    TOKEN_AUTH_REFRESH_TOKEN_PORT,
    type AccessTokenPayload,
    type RefreshTokenPayload,
} from 'src/core/security/auth';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import type { ITokenPort } from 'src/core/security/token';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
import { user } from 'src/module/user/infrastructure/user.schema';
import { PrincipalType } from 'src/shared/domain/principal';
import { createTestApp } from 'test/shared/test-app.factory';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe.each(Object.values(PrincipalType))('%s HTTP session request idempotency', (type) => {
    let app: NestFastifyApplication;
    let database: NodePgDatabase;
    let redis: Redis;
    let refreshTokens: ITokenPort<typeof REFRESH_TOKEN_TYPE>;
    let boss: PgBoss;
    let hash: string;
    let id: string;
    let email: string;
    const password = 'Idempotency-login!123',
        table = type === PrincipalType.USER ? user : admin;

    beforeAll(async () => {
        app = await createTestApp();
        database = app.get(TOKEN_DATABASE_CLIENT);
        redis = app.get(TOKEN_SESSION_CONNECTION);
        refreshTokens = app.get(TOKEN_AUTH_REFRESH_TOKEN_PORT);
        boss = app.get(TOKEN_JOB_QUEUE_CLIENT);
        hash = await app.get<IHashingPort>(TOKEN_HASHING_PORT).hashPassword(password);
        for (const queue of await boss.getQueues()) {
            await boss.offWork(queue.name);
        }
    }, 30_000);

    beforeEach(async () => {
        id = uuidv7();
        email = `${id}@example.test`;
        await database
            .insert(table)
            .values({ id, email, name: 'Retry fixture', password: hash, avatarKey: `avatar/${id}` });
    });

    afterEach(async () => {
        for (const queue of await boss.getQueues()) {
            const jobs = await boss.findJobs(queue.name, { data: { aggregateId: id } });
            if (jobs.length) {
                await boss.deleteJob(
                    queue.name,
                    jobs.map((job) => job.id),
                );
            }
        }
        await database.delete(audit).where(or(eq(audit.actorId, id), eq(audit.targetId, id)));
        await database.delete(table).where(eq(table.id, id));
        let cursor = '0';
        do {
            const [next, keys] = await redis.scan(cursor, 'MATCH', `auth:{${type}:${id}}:*`, 'COUNT', 100);
            cursor = next;
            for (const key of keys) {
                await redis.del(key);
            }
        } while (cursor !== '0');
    });

    afterAll(async () => {
        await app?.close();
    });

    /**
     * Sends one logical credential login through production validation.
     *
     * @param key Stable request identity, absent when validating the required header.
     * @param suppliedPassword Credential proof.
     * @returns Serialized HTTP response.
     */
    function login(
        key: string | null = randomUUID(),
        suppliedPassword = password,
    ): ReturnType<NestFastifyApplication['inject']> {
        return app.inject({
            method: 'POST',
            url: `/api/v1/auth/${type}/login`,
            ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
            payload: { email, password: suppliedPassword },
        });
    }

    /**
     * Rotates a credential with a client-selected retry identity.
     *
     * @param refreshToken Previously issued credential.
     * @param key Stable request identity, absent for required-header coverage.
     * @returns Serialized HTTP response.
     */
    function refresh(refreshToken: string, key: string | null): ReturnType<NestFastifyApplication['inject']> {
        return app.inject({
            method: 'POST',
            url: '/api/v1/auth/refresh',
            ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
            payload: { refreshToken },
        });
    }

    it.each([null, 'invalid', '', '00000000-0000-1000-8000-000000000000'])(
        'rejects missing or malformed login/refresh key %j before mutation',
        async (key) => {
            for (const response of [await login(key), await refresh('invalid', key)]) {
                expect(response.statusCode).toBe(400);
                expect(response.json<unknown>()).toMatchObject({
                    error: { statusCode: 400, statusText: 'Bad Request', message: expect.any(Array) as unknown },
                });
            }
            expect(await redis.hlen(`auth:{${type}:${id}}:sessions`)).toBe(0);
        },
    );

    it('opens one session for concurrent same-key login and replays before password work', async () => {
        const key = randomUUID(),
            responses = await Promise.all([login(key), login(key)]);
        for (const response of responses) {
            expect(response.statusCode).toBe(200);
        }
        const first = responses[0].json<{ data: { refreshToken: string } }>().data,
            second = responses[1].json<{ data: { refreshToken: string } }>().data;
        expect(await refreshTokens.verify<RefreshTokenPayload>(second.refreshToken, REFRESH_TOKEN_TYPE)).toEqual(
            await refreshTokens.verify<RefreshTokenPayload>(first.refreshToken, REFRESH_TOKEN_TYPE),
        );
        expect(await redis.hlen(`auth:{${type}:${id}}:sessions`)).toBe(1);
        const verify = vi.spyOn(app.get<IHashingPort>(TOKEN_HASHING_PORT), 'verifyPassword'),
            replay = await login(key);
        expect(replay.statusCode).toBe(200);
        expect(verify).not.toHaveBeenCalled();
        expect(
            await database
                .select()
                .from(audit)
                .where(and(eq(audit.targetId, id), eq(audit.action, AuthAuditAction.LOGIN_SUCCESS))),
        ).toHaveLength(1);
    });

    it('rejects changed login semantics before password work without opening another session', async () => {
        const key = randomUUID();
        expect((await login(key)).statusCode).toBe(200);
        const verify = vi.spyOn(app.get<IHashingPort>(TOKEN_HASHING_PORT), 'verifyPassword');
        expect((await login(key, 'Changed-password!123')).statusCode).toBe(409);
        expect(verify).not.toHaveBeenCalled();
        expect(await redis.hlen(`auth:{${type}:${id}}:sessions`)).toBe(1);
    });

    it.each(['login', 'refresh'] as const)(
        'recomputes access expiry on %s replay while preserving the registered refresh credential',
        async (operation) => {
            const key = randomUUID(),
                initial = await login(operation === 'login' ? key : randomUUID());
            expect(initial.statusCode).toBe(200);
            const original = initial.json<{ data: { accessToken: string; refreshToken: string } }>().data,
                first = operation === 'login' ? initial : await refresh(original.refreshToken, key);
            expect(first.statusCode).toBe(200);
            const pair = first.json<{ data: { accessToken: string; refreshToken: string } }>().data,
                accessTokens = app.get<ITokenPort<typeof ACCESS_TOKEN_TYPE>>(TOKEN_AUTH_ACCESS_TOKEN_PORT),
                claims = await accessTokens.verify<AccessTokenPayload>(pair.accessToken, ACCESS_TOKEN_TYPE),
                registration = await redis.hgetall(`auth:{${type}:${id}}:sessions`),
                refreshClaims = await refreshTokens.verify<RefreshTokenPayload>(pair.refreshToken, REFRESH_TOKEN_TYPE),
                replayNow = Date.now() + 30_000;
            vi.spyOn(Date, 'now').mockReturnValue(replayNow);

            const replay = operation === 'login' ? await login(key) : await refresh(original.refreshToken, key);
            expect(replay.statusCode).toBe(200);
            const replayPair = replay.json<{ data: { accessToken: string; refreshToken: string } }>().data,
                replayClaims = await accessTokens.verify<AccessTokenPayload>(replayPair.accessToken, ACCESS_TOKEN_TYPE),
                accessTtl = parseTtlToSeconds(app.get(ConfigService).getOrThrow<string>(ENV.JWT_ACCESS_TTL));
            expect(replayClaims).toEqual({
                ...claims,
                exp: Math.min(Math.floor(replayNow / 1000) + accessTtl, refreshClaims.exp),
            });
            expect(replayClaims.exp).toBeGreaterThan(claims.exp);
            expect(replayPair.refreshToken).toBe(pair.refreshToken);
            expect(await redis.hgetall(`auth:{${type}:${id}}:sessions`)).toEqual(registration);
        },
    );

    it('recovers login after signing fails without opening another session or retaining credentials', async () => {
        const key = randomUUID(),
            sign = vi.spyOn(refreshTokens, 'sign').mockRejectedValueOnce(new Error('Lost credential response'));
        expect((await login(key)).statusCode).toBe(500);
        const before = await redis.hgetall(`auth:{${type}:${id}}:sessions`);
        expect(Object.keys(before)).toHaveLength(1);
        expect((await login(key)).statusCode).toBe(200);
        expect(await redis.hgetall(`auth:{${type}:${id}}:sessions`)).toEqual(before);
        expect(sign).toHaveBeenCalledTimes(2);
        const retained = await redis.get(`auth:{${type}:${id}}:idempotency:${key}`);
        expect(JSON.parse(retained!) as unknown).toEqual({
            fingerprint: expect.any(String) as unknown,
            sid: expect.any(String) as unknown,
            jti: expect.any(String) as unknown,
        });
    });

    it('replays successful refresh after input credential expiry while a new key cannot rotate it', async () => {
        const response = await login(),
            pair = response.json<{ data: { accessToken: string; refreshToken: string } }>().data,
            refreshClaims = await refreshTokens.verify<RefreshTokenPayload>(pair.refreshToken, REFRESH_TOKEN_TYPE),
            now = Date.now(),
            shortenedRefreshToken = await refreshTokens.sign<RefreshTokenPayload>(REFRESH_TOKEN_TYPE, {
                sub: refreshClaims.sub,
                principalType: refreshClaims.principalType,
                sid: refreshClaims.sid,
                sessionExpiresAt: refreshClaims.sessionExpiresAt,
                jti: refreshClaims.jti,
                sessionVersion: refreshClaims.sessionVersion,
                exp: Math.floor(now / 1000) + 1,
            }),
            key = randomUUID(),
            first = await refresh(shortenedRefreshToken, key);
        expect(first.statusCode).toBe(200);
        vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
        expect((await refresh(shortenedRefreshToken, key)).statusCode).toBe(200);
        expect((await refresh(shortenedRefreshToken, randomUUID())).statusCode).toBe(401);
        expect(await redis.hlen(`auth:{${type}:${id}}:sessions`)).toBe(1);
    });

    it('preserves refresh success outside grace, does not remediate reuse, and keeps logout repeat-safe without a key', async () => {
        const loginResponse = await login(),
            original = loginResponse.json<{ data: { refreshToken: string } }>().data,
            originalClaims = await refreshTokens.verify<RefreshTokenPayload>(original.refreshToken, REFRESH_TOKEN_TYPE),
            key = randomUUID(),
            responses = await Promise.all([refresh(original.refreshToken, key), refresh(original.refreshToken, key)]);
        expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
        const winning = responses[0].json<{ data: { refreshToken: string; accessToken: string } }>().data,
            winningClaims = await refreshTokens.verify<RefreshTokenPayload>(winning.refreshToken, REFRESH_TOKEN_TYPE);
        expect(winningClaims.sid).toBe(originalClaims.sid);
        expect(winningClaims.jti).not.toBe(originalClaims.jti);
        expect(
            await refreshTokens.verify<RefreshTokenPayload>(
                responses[1].json<{ data: { refreshToken: string } }>().data.refreshToken,
                REFRESH_TOKEN_TYPE,
            ),
        ).toEqual(winningClaims);
        await redis.del(`auth:{${type}:${id}}:rotated:${originalClaims.sid}:${originalClaims.jti}`);
        expect((await refresh(original.refreshToken, key)).statusCode).toBe(200);
        // Reusing the same key with the winning credential changes semantic input.
        expect((await refresh(winning.refreshToken, key)).statusCode).toBe(409);
        expect(
            await database
                .select()
                .from(audit)
                .where(
                    and(
                        eq(audit.targetId, id),
                        or(
                            eq(audit.action, AuthAuditAction.REFRESH_REUSE_DETECTED),
                            eq(audit.action, AuthAuditAction.REFRESH_CONCURRENT_REPLAY),
                        ),
                    ),
                ),
        ).toHaveLength(0);
        for (const queue of await boss.getQueues()) {
            expect(await boss.findJobs(queue.name, { data: { aggregateId: id } })).toHaveLength(0);
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            const logout = await app.inject({
                method: 'POST',
                url: '/api/v1/auth/logout',
                payload: { refreshToken: original.refreshToken },
            });
            expect(logout.statusCode).toBe(204);
            expect(logout.body).toBe('');
        }
        expect(await redis.hlen(`auth:{${type}:${id}}:sessions`)).toBe(0);
        expect((await refresh(original.refreshToken, key)).statusCode).toBe(401);
    });
});
