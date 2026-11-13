/**
 * @file session-namespace.e2e-spec.ts
 * @description Verifies principal-scoped session isolation through the production port and real Redis.
 */

import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import {
    OpenSessionOutcome,
    ReplaySessionOutcome,
    RotateSessionOutcome,
    SessionModule,
    TOKEN_SESSION_PORT,
    type ISessionPort,
    type SessionRegistration,
    type SessionRequestIdentity,
} from 'src/core/security/session';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException } from 'src/shared/exception';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Principal-scoped Redis sessions', () => {
    let module: TestingModule;
    let sessions: ISessionPort;
    let redis: Redis;
    const keys = new Set<string>();

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, envFilePath: resolveEnvFilePath(), validate: validateConfig }),
                SessionModule,
            ],
        }).compile();
        await module.init();
        sessions = module.get(TOKEN_SESSION_PORT);
        redis = module.get(TOKEN_SESSION_CONNECTION);
        if (redis.status !== 'ready') {
            await once(redis, 'ready', { signal: AbortSignal.timeout(5000) });
        }
    });

    afterEach(async () => {
        // Delete exact run-owned keys individually; principals need not share a cluster slot.
        for (const key of keys) {
            await redis.del(key);
        }
        keys.clear();
    });

    afterAll(async () => {
        await module?.close();
    });

    /**
     * Supplies a new logical fixture operation and tracks its bounded Redis claim for cleanup.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @returns Request identity for one independent fixture mutation.
     */
    function request(id: string, principalType: PrincipalType): SessionRequestIdentity {
        const key = randomUUID();
        keys.add(`auth:{${principalType}:${id}}:idempotency:${key}`);
        return { key, fingerprint: 'session-fixture' };
    }

    /**
     * Opens fixture state through the session authority and tracks its hash and grace marker.
     *
     * @param id Shared principal identifier.
     * @param principalType Owning context.
     * @param version Initial access floor.
     * @returns The registration selected by the atomic session operation.
     */
    async function registration(
        id: string,
        principalType: PrincipalType,
        version: number,
    ): Promise<SessionRegistration> {
        const prefix = `auth:{${principalType}:${id}}`;
        keys.add(`${prefix}:version`);
        keys.add(`${prefix}:sessions`);
        const { outcome, session } = await sessions.openSession(request(id, principalType), id, principalType, version);
        expect(outcome).toBe(OpenSessionOutcome.OPENED);
        keys.add(`${prefix}:rotated:${session!.sid}:${session!.refreshCredentialId}`);
        return session!;
    }

    it('disables offline queuing and automatic unfulfilled-command resend on the production session client', () => {
        expect(redis.options.enableOfflineQueue).toBe(false);
        expect(redis.options.autoResendUnfulfilledCommands).toBe(false);
    });

    it.each([
        [PrincipalType.USER, PrincipalType.ADMIN],
        [PrincipalType.ADMIN, PrincipalType.USER],
    ])('isolates %s version synchronization and revocation from %s with the same id', async (type, otherType) => {
        const id = randomUUID();
        const session = await registration(id, type, 8);
        const other = await registration(id, otherType, 1);
        expect(await sessions.getVersion(id, type)).toBe(8);
        expect(await sessions.getVersion(id, otherType)).toBe(1);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);

        await sessions.setVersion(id, type, 9);
        await sessions.setVersion(id, type, 2);
        expect(await sessions.getVersion(id, type)).toBe(9);
        expect(await sessions.isSessionActive(id, type, session.sid, 8)).toBe(false);
        expect(
            await sessions.rotateSession(request(id, session.principalType), id, session.refreshCredentialId, session),
        ).toMatchObject({ outcome: RotateSessionOutcome.VERSION_SUPERSEDED });
        expect(
            await sessions.openSession(
                request(id, session.principalType),
                id,
                session.principalType,
                session.sessionVersion,
            ),
        ).toMatchObject({ outcome: OpenSessionOutcome.VERSION_SUPERSEDED, session: null });
        expect(await sessions.getVersion(id, otherType)).toBe(1);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        expect(
            await sessions.rotateSession(request(id, other.principalType), id, other.refreshCredentialId, other),
        ).toMatchObject({ outcome: RotateSessionOutcome.ROTATED });
    });

    it.each([
        [PrincipalType.USER, PrincipalType.ADMIN],
        [PrincipalType.ADMIN, PrincipalType.USER],
    ])('isolates %s rotation markers, reuse closure, and logout from %s', async (type, otherType) => {
        const id = randomUUID();
        const session = await registration(id, type, 1);
        const other = await registration(id, otherType, 1);
        const replacement = session;
        expect(
            await sessions.rotateSession(
                request(id, replacement.principalType),
                id,
                session.refreshCredentialId,
                replacement,
            ),
        ).toMatchObject({ outcome: RotateSessionOutcome.ROTATED });
        expect(
            await sessions.rotateSession(
                request(id, replacement.principalType),
                id,
                session.refreshCredentialId,
                replacement,
            ),
        ).toMatchObject({ outcome: RotateSessionOutcome.CONCURRENT_REPLAY });
        expect(
            await redis.exists(`auth:{${otherType}:${id}}:rotated:${session.sid}:${session.refreshCredentialId}`),
        ).toBe(0);
        expect(
            await sessions.rotateSession(request(id, other.principalType), id, other.refreshCredentialId, other),
        ).toMatchObject({ outcome: RotateSessionOutcome.ROTATED });

        // Expire only this principal's grace marker to exercise reuse outside grace without a timed wait.
        await redis.del(`auth:{${type}:${id}}:rotated:${session.sid}:${session.refreshCredentialId}`);
        expect(
            await sessions.rotateSession(
                request(id, replacement.principalType),
                id,
                session.refreshCredentialId,
                replacement,
            ),
        ).toMatchObject({ outcome: RotateSessionOutcome.REUSE_DETECTED });
        expect(await sessions.isSessionActive(id, type, session.sid, 1)).toBe(false);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        expect(await sessions.getVersion(id, type)).toBe(1);

        await sessions.closeSession(id, type, session.sid);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        await sessions.closeSession(id, otherType, other.sid);
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(false);
        expect(
            await sessions.rotateSession(request(id, other.principalType), id, other.refreshCredentialId, other),
        ).toMatchObject({
            outcome: RotateSessionOutcome.SESSION_CLOSED,
        });
    });

    it.each([
        [PrincipalType.USER, PrincipalType.ADMIN],
        [PrincipalType.ADMIN, PrincipalType.USER],
    ])('logs out a live %s session without closing the same-id %s session', async (type, otherType) => {
        const id = randomUUID();
        const session = await registration(id, type, 1);
        const other = await registration(id, otherType, 1);
        await sessions.closeSession(id, type, session.sid);
        expect(await sessions.isSessionActive(id, type, session.sid, 1)).toBe(false);
        expect(
            await sessions.rotateSession(request(id, session.principalType), id, session.refreshCredentialId, session),
        ).toMatchObject({ outcome: RotateSessionOutcome.SESSION_CLOSED });
        expect(await sessions.isSessionActive(id, otherType, other.sid, 1)).toBe(true);
        expect(
            await sessions.rotateSession(request(id, other.principalType), id, other.refreshCredentialId, other),
        ).toMatchObject({ outcome: RotateSessionOutcome.ROTATED });
    });

    it('denies a missing principal version even when the other kind has a live session', async () => {
        const id = randomUUID();
        const session = await registration(id, PrincipalType.ADMIN, 1);
        expect(await sessions.getVersion(id, PrincipalType.USER)).toBeNull();
        expect(await sessions.isSessionActive(id, PrincipalType.USER, session.sid, 1)).toBe(false);
        await redis.del(`auth:{${PrincipalType.ADMIN}:${id}}:version`);
        expect(await sessions.isSessionActive(id, PrincipalType.ADMIN, session.sid, 1)).toBe(false);
    });
    describe.each(Object.values(PrincipalType))('%s request coordination', (type) => {
        it.each(['open', 'rotate'] as const)(
            'applies %s once under concurrent retry and rejects changed semantics',
            async (operation) => {
                const id = randomUUID(),
                    original = await registration(id, type, 1),
                    input = request(id, type),
                    prefix = `auth:{${type}:${id}}`,
                    mutate = (value = input) =>
                        operation === 'open'
                            ? sessions.openSession(value, id, type, 1)
                            : sessions.rotateSession(value, id, original.refreshCredentialId, original),
                    results = await Promise.all([mutate(), mutate(), mutate()]),
                    winner = results.find(
                        (result) =>
                            result.outcome ===
                            (operation === 'open' ? OpenSessionOutcome.OPENED : RotateSessionOutcome.ROTATED),
                    );
                expect(winner?.session).not.toBeNull();
                expect(results.filter((result) => result.outcome === ReplaySessionOutcome.REPLAYED)).toHaveLength(2);
                for (const result of results) {
                    expect(result.session).toEqual(winner!.session);
                }
                expect(await redis.hlen(`${prefix}:sessions`)).toBe(operation === 'open' ? 2 : 1);
                const before = await redis.hgetall(`${prefix}:sessions`);
                expect(await mutate({ ...input, fingerprint: 'different semantics' })).toMatchObject({
                    outcome: ReplaySessionOutcome.CONFLICT,
                    session: null,
                });
                expect(await redis.hgetall(`${prefix}:sessions`)).toEqual(before);
                // Even outside rotation grace, retained success must win over reuse remediation.
                await redis.del(`${prefix}:rotated:${original.sid}:${original.refreshCredentialId}`);
                expect(await mutate()).toMatchObject({
                    outcome: ReplaySessionOutcome.REPLAYED,
                    session: winner!.session,
                });
                expect(await sessions.isSessionActive(id, type, winner!.session!.sid, 1)).toBe(true);
            },
        );

        it.each(['open', 'rotate'] as const)(
            'does not renew request, field, or version deadlines on %s replay',
            async (operation) => {
                const id = randomUUID(),
                    original = await registration(id, type, 1),
                    input = request(id, type),
                    prefix = `auth:{${type}:${id}}`,
                    requestKey = `${prefix}:idempotency:${input.key}`,
                    mutate = () =>
                        operation === 'open'
                            ? sessions.openSession(input, id, type, 1)
                            : sessions.rotateSession(input, id, original.refreshCredentialId, original),
                    first = await mutate(),
                    sid = first.session!.sid;
                expect(await redis.ttl(requestKey)).toBeGreaterThanOrEqual(119);
                expect(await redis.ttl(requestKey)).toBeLessThanOrEqual(120);
                // A shorter remaining window makes an accidental 120-second renewal observable without waiting.
                await redis.pexpire(requestKey, 60_000);
                const deadlines = async () =>
                        Promise.all([
                            redis.pexpiretime(requestKey),
                            redis.pexpiretime(`${prefix}:version`),
                            redis.call('HPEXPIRETIME', `${prefix}:sessions`, 'FIELDS', 1, sid),
                        ]),
                    before = await deadlines();
                expect(await sessions.findSessionRequestReplay(input, id, type)).toMatchObject({
                    outcome: ReplaySessionOutcome.REPLAYED,
                    session: first.session,
                });
                expect(await mutate()).toMatchObject({
                    outcome: ReplaySessionOutcome.REPLAYED,
                    session: first.session,
                });
                expect(await deadlines()).toEqual(before);
                expect(await redis.call('HEXPIRETIME', `${prefix}:sessions`, 'FIELDS', 1, sid)).toEqual([
                    first.session!.refreshExpiresAt,
                ]);
                await redis.pexpireat(requestKey, Date.now() - 1);
                expect(await sessions.findSessionRequestReplay(input, id, type)).toMatchObject({
                    outcome: ReplaySessionOutcome.NOT_FOUND,
                    session: null,
                });
                expect(await sessions.isSessionActive(id, type, sid, 1)).toBe(true);
            },
        );

        it.each(['open', 'rotate'] as const)(
            'recovers an ambiguous %s result through same-key retry without a second mutation',
            async (operation) => {
                const id = randomUUID(),
                    original = await registration(id, type, 1),
                    input = request(id, type),
                    prefix = `auth:{${type}:${id}}`,
                    evalCommand = redis.eval.bind(redis),
                    evaluate = vi
                        .spyOn(redis, 'eval')
                        .mockImplementationOnce(async (...args: Parameters<Redis['eval']>) => {
                            await evalCommand(...args);
                            throw new Error('Command timed out');
                        }),
                    mutate = () =>
                        operation === 'open'
                            ? sessions.openSession(input, id, type, 1)
                            : sessions.rotateSession(input, id, original.refreshCredentialId, original);
                await expect(mutate()).rejects.toBeInstanceOf(DependencyUnavailableException);
                expect(evaluate).toHaveBeenCalledTimes(1);
                const before = await redis.hgetall(`${prefix}:sessions`),
                    replay = await mutate();
                expect(replay.outcome).toBe(ReplaySessionOutcome.REPLAYED);
                expect(await redis.hgetall(`${prefix}:sessions`)).toEqual(before);
                expect(Object.keys(before)).toHaveLength(operation === 'open' ? 2 : 1);
            },
        );

        it('expires SID fields independently and never revives a closed retained session', async () => {
            const id = randomUUID(),
                first = await registration(id, type, 1),
                input = request(id, type),
                second = await sessions.openSession(input, id, type, 1),
                hash = `auth:{${type}:${id}}:sessions`;
            await redis.call('HPEXPIREAT', hash, Date.now() - 1, 'FIELDS', 1, first.sid);
            expect(await sessions.isSessionActive(id, type, first.sid, 1)).toBe(false);
            expect(await sessions.isSessionActive(id, type, second.session!.sid, 1)).toBe(true);
            await sessions.closeSession(id, type, second.session!.sid);
            await sessions.closeSession(id, type, second.session!.sid);
            expect(await sessions.openSession(input, id, type, 1)).toMatchObject({
                outcome: ReplaySessionOutcome.REPLAY_UNAVAILABLE,
                session: null,
            });
            expect(await redis.hlen(hash)).toBe(0);
        });

        it.each(['open', 'rotate'] as const)(
            'retains no successful request after %s version rejection and permits a corrected attempt',
            async (operation) => {
                const id = randomUUID(),
                    original = await registration(id, type, 1),
                    input = request(id, type),
                    prefix = `auth:{${type}:${id}}`;
                await sessions.setVersion(id, type, 2);
                const rejected =
                    operation === 'open'
                        ? await sessions.openSession(input, id, type, 1)
                        : await sessions.rotateSession(input, id, original.refreshCredentialId, original);
                expect(rejected).toMatchObject({
                    outcome:
                        operation === 'open'
                            ? OpenSessionOutcome.VERSION_SUPERSEDED
                            : RotateSessionOutcome.VERSION_SUPERSEDED,
                    session: null,
                });
                expect(await redis.exists(`${prefix}:idempotency:${input.key}`)).toBe(0);
                const accepted =
                    operation === 'open'
                        ? await sessions.openSession(input, id, type, 2)
                        : await sessions.rotateSession(input, id, original.refreshCredentialId, {
                              ...original,
                              sessionVersion: 2,
                          });
                expect(accepted.outcome).toBe(
                    operation === 'open' ? OpenSessionOutcome.OPENED : RotateSessionOutcome.ROTATED,
                );
            },
        );

        it.each(['closed', 'missing-version', 'within-grace', 'reuse'] as const)(
            'preserves rotation %s refusal without retaining successful request metadata',
            async (scenario) => {
                const id = randomUUID(),
                    original = await registration(id, type, 1),
                    input = request(id, type),
                    prefix = `auth:{${type}:${id}}`;
                let expected: RotateSessionOutcome;
                switch (scenario) {
                    case 'closed':
                        await sessions.closeSession(id, type, original.sid);
                        expected = RotateSessionOutcome.SESSION_CLOSED;
                        break;
                    case 'missing-version':
                        await redis.del(`${prefix}:version`);
                        expected = RotateSessionOutcome.SESSION_UNAVAILABLE;
                        break;
                    case 'within-grace':
                    case 'reuse':
                        await sessions.rotateSession(request(id, type), id, original.refreshCredentialId, original);
                        if (scenario === 'reuse') {
                            await redis.del(`${prefix}:rotated:${original.sid}:${original.refreshCredentialId}`);
                        }
                        expected =
                            scenario === 'reuse'
                                ? RotateSessionOutcome.REUSE_DETECTED
                                : RotateSessionOutcome.CONCURRENT_REPLAY;
                        break;
                }
                expect(await sessions.rotateSession(input, id, original.refreshCredentialId, original)).toEqual({
                    outcome: expected,
                    session: null,
                });
                expect(await redis.exists(`${prefix}:idempotency:${input.key}`)).toBe(0);
                expect(await sessions.isSessionActive(id, type, original.sid, 1)).toBe(scenario === 'within-grace');
            },
        );

        it.each(['revoked', 'missing-version', 'rotated'] as const)(
            'refuses retained opening after the registration is %s without recreating it',
            async (scenario) => {
                const id = randomUUID();
                await registration(id, type, 1);
                const input = request(id, type),
                    first = await sessions.openSession(input, id, type, 1),
                    prefix = `auth:{${type}:${id}}`;
                if (scenario === 'revoked') {
                    await sessions.setVersion(id, type, 2);
                } else if (scenario === 'missing-version') {
                    await redis.del(`${prefix}:version`);
                } else {
                    const rotationInput = request(id, type);
                    keys.add(`${prefix}:rotated:${first.session!.sid}:${first.session!.refreshCredentialId}`);
                    await sessions.rotateSession(rotationInput, id, first.session!.refreshCredentialId, first.session!);
                }
                const before = await redis.hgetall(`${prefix}:sessions`),
                    expected =
                        scenario === 'revoked'
                            ? ReplaySessionOutcome.VERSION_SUPERSEDED
                            : scenario === 'missing-version'
                              ? ReplaySessionOutcome.SESSION_UNAVAILABLE
                              : ReplaySessionOutcome.REPLAY_UNAVAILABLE;
                expect(await sessions.findSessionRequestReplay(input, id, type)).toEqual({
                    outcome: expected,
                    session: null,
                });
                expect(await sessions.openSession(input, id, type, 1)).toEqual({ outcome: expected, session: null });
                expect(await redis.hgetall(`${prefix}:sessions`)).toEqual(before);
            },
        );

        it('keeps version updates monotonic without shortening existing retention on repeated or older writes', async () => {
            const id = randomUUID();
            await registration(id, type, 1);
            const key = `auth:{${type}:${id}}:version`;
            await redis.expire(key, 2_000_000);
            const deadline = await redis.pexpiretime(key);
            await Promise.all([
                sessions.setVersion(id, type, 9),
                sessions.setVersion(id, type, 2),
                sessions.setVersion(id, type, 9),
            ]);
            expect(await sessions.getVersion(id, type)).toBe(9);
            expect(await redis.pexpiretime(key)).toBeGreaterThanOrEqual(deadline - 1000);
        });
    });
});
