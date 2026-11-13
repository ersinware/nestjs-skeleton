/**
 * @file request-idempotency.e2e-spec.ts
 * @description Exercises login and refresh retries through production HTTP, JWT, Redis, and durable evidence.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { audit } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
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
    let tokens: ITokenPort;
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
        tokens = app.get(TOKEN_TOKEN_PORT);
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
        expect(await tokens.verifyRefreshToken(second.refreshToken)).toEqual(
            await tokens.verifyRefreshToken(first.refreshToken),
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

    it('recovers login after signing fails without opening another session or retaining credentials', async () => {
        const key = randomUUID(),
            sign = vi.spyOn(tokens, 'generateTokens').mockRejectedValueOnce(new Error('Lost credential response'));
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
            refreshClaims = await tokens.verifyRefreshToken(pair.refreshToken),
            accessClaims = await tokens.verifyAccessToken(pair.accessToken),
            now = Date.now(),
            shortened = await tokens.generateTokens(accessClaims, {
                ...refreshClaims,
                exp: Math.floor(now / 1000) + 1,
            }),
            key = randomUUID(),
            first = await refresh(shortened.refreshToken, key);
        expect(first.statusCode).toBe(200);
        vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
        expect((await refresh(shortened.refreshToken, key)).statusCode).toBe(200);
        expect((await refresh(shortened.refreshToken, randomUUID())).statusCode).toBe(401);
        expect(await redis.hlen(`auth:{${type}:${id}}:sessions`)).toBe(1);
    });

    it('preserves refresh success outside grace, does not remediate reuse, and keeps logout repeat-safe without a key', async () => {
        const loginResponse = await login(),
            original = loginResponse.json<{ data: { refreshToken: string } }>().data,
            originalClaims = await tokens.verifyRefreshToken(original.refreshToken),
            key = randomUUID(),
            responses = await Promise.all([refresh(original.refreshToken, key), refresh(original.refreshToken, key)]);
        expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
        const winning = responses[0].json<{ data: { refreshToken: string; accessToken: string } }>().data,
            winningClaims = await tokens.verifyRefreshToken(winning.refreshToken);
        expect(winningClaims.sid).toBe(originalClaims.sid);
        expect(winningClaims.jti).not.toBe(originalClaims.jti);
        expect(
            await tokens.verifyRefreshToken(responses[1].json<{ data: { refreshToken: string } }>().data.refreshToken),
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
