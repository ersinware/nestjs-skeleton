/**
 * @file session.adapter.spec.ts
 * @description Verifies principal key colocation and session-store error translation at the Redis boundary.
 */

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ENV } from 'src/core/config';
import { SessionAdapter } from 'src/core/security/session/adapter/session.adapter';
import {
    OpenSessionOutcome,
    ReplaySessionOutcome,
    RotateSessionOutcome,
    type SessionRegistration,
} from 'src/core/security/session/port/session.port';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SessionAdapter', () => {
    const redis = {
        eval: vi.fn(),
        hdel: vi.fn(),
        get: vi.fn(),
    };

    let adapter: SessionAdapter;

    beforeEach(() => {
        const configService = new ConfigService({
            [ENV.SESSION_REFRESH_TTL]: '7d',
            [ENV.SESSION_ROTATION_GRACE_TTL]: '30s',
            [ENV.SESSION_ABSOLUTE_TTL_ADMIN]: '8h',
            [ENV.SESSION_ABSOLUTE_TTL_USER]: '7d',
        });

        adapter = new SessionAdapter(redis as unknown as Redis, configService);
    });

    it('translates an unavailable session deletion without reporting logout success', async () => {
        redis.hdel.mockRejectedValueOnce(new Error('Connection is closed.'));
        await expect(adapter.closeSession('id', PrincipalType.USER, 'sid')).rejects.toBeInstanceOf(
            DependencyUnavailableException,
        );
    });

    describe.each(Object.values(PrincipalType))('%s namespace', (principalType) => {
        it('passes the same complete principal hash tag to every Lua script', async () => {
            const session: SessionRegistration = {
                principalType,
                sid: 'sid',
                refreshCredentialId: 'new-jti',
                sessionVersion: 1,
                sessionExpiresAt: 2_000_000_000,
                refreshExpiresAt: 2_000_000_000,
            };
            redis.eval
                .mockResolvedValueOnce([ReplaySessionOutcome.NOT_FOUND, null])
                .mockResolvedValueOnce([OpenSessionOutcome.OPENED, JSON.stringify(session)])
                .mockResolvedValueOnce([RotateSessionOutcome.ROTATED, JSON.stringify(session)])
                .mockResolvedValue(1);
            await adapter.findSessionRequestReplay(
                { key: randomUUID(), fingerprint: 'fingerprint' },
                'id',
                principalType,
            );
            await adapter.openSession({ key: randomUUID(), fingerprint: 'fingerprint' }, 'id', principalType, 1);
            await adapter.rotateSession({ key: randomUUID(), fingerprint: 'fingerprint' }, 'id', 'old-jti', session);
            await adapter.isSessionActive('id', principalType, 'sid', 1);
            await adapter.setVersion('id', principalType, 2);

            const prefix = `auth:{${principalType}:id}`;
            const keysByScript = redis.eval.mock.calls.map(([, count, ...args]) =>
                args.slice(0, Number(count)).map(String),
            );
            expect(keysByScript).toEqual([
                [expect.stringContaining(`${prefix}:idempotency:`), `${prefix}:version`, `${prefix}:sessions`],
                [expect.stringContaining(`${prefix}:idempotency:`), `${prefix}:version`, `${prefix}:sessions`],
                [
                    expect.stringContaining(`${prefix}:idempotency:`),
                    `${prefix}:version`,
                    `${prefix}:sessions`,
                    `${prefix}:rotated:sid:old-jti`,
                ],
                [`${prefix}:version`, `${prefix}:sessions`],
                [`${prefix}:version`],
            ]);
            for (const keys of keysByScript) {
                // Redis Cluster hashes only the first non-empty {...} tag, so identical tags guarantee one slot.
                expect(new Set(keys.map((key) => /\{([^{}]+)\}/u.exec(String(key))?.[1]))).toEqual(
                    new Set([`${principalType}:id`]),
                );
            }
        });

        it('uses the principal namespace for direct version reads and logout deletion', async () => {
            redis.get.mockResolvedValueOnce(null);
            expect(await adapter.getVersion('id', principalType)).toBeNull();
            expect(redis.get).toHaveBeenCalledWith(`auth:{${principalType}:id}:version`);
            await adapter.closeSession('id', principalType, 'sid');
            expect(redis.hdel).toHaveBeenCalledWith(`auth:{${principalType}:id}:sessions`, 'sid');
        });
    });

    describe.each(['open', 'rotate'] as const)('%s request contract', (operation) => {
        const request = { key: 'request-key', fingerprint: 'fingerprint' },
            session: SessionRegistration = {
                principalType: PrincipalType.USER,
                sid: 'sid',
                refreshCredentialId: 'jti',
                sessionVersion: 1,
                sessionExpiresAt: 2_000_000_000,
                refreshExpiresAt: 1_900_000_000,
            };

        it.each([
            ReplaySessionOutcome.REPLAYED,
            operation === 'open' ? OpenSessionOutcome.OPENED : RotateSessionOutcome.ROTATED,
        ])('returns the authoritative %s identity with one Lua call', async (outcome) => {
            redis.eval.mockResolvedValueOnce([outcome, JSON.stringify(session)]);
            const result =
                operation === 'open'
                    ? await adapter.openSession(request, 'id', PrincipalType.USER, 1)
                    : await adapter.rotateSession(request, 'id', 'old-jti', session);
            expect(result).toEqual({ outcome, session });
            expect(redis.eval).toHaveBeenCalledTimes(1);
            const [, count, ...args] = redis.eval.mock.calls[0]! as readonly unknown[];
            expect(args[0]).toBe('auth:{user:id}:idempotency:request-key');
            expect(args[Number(count)]).toBe('fingerprint');
            expect(args.at(-1)).toBe(120);
        });

        it.each([
            ReplaySessionOutcome.CONFLICT,
            ReplaySessionOutcome.REPLAY_UNAVAILABLE,
            ReplaySessionOutcome.SESSION_UNAVAILABLE,
            ReplaySessionOutcome.VERSION_SUPERSEDED,
        ] as const)('preserves %s without credentials or a second attempt', async (outcome) => {
            redis.eval.mockResolvedValueOnce([outcome, null]);
            const result =
                operation === 'open'
                    ? await adapter.openSession(request, 'id', PrincipalType.USER, 1)
                    : await adapter.rotateSession(request, 'id', 'old-jti', session);
            expect(result).toEqual({ outcome, session: null });
            expect(redis.eval).toHaveBeenCalledTimes(1);
        });

        it('does not automatically retry an ambiguous mutation', async () => {
            redis.eval.mockRejectedValueOnce(new Error('Command timed out'));
            await expect(
                operation === 'open'
                    ? adapter.openSession(request, 'id', PrincipalType.USER, 1)
                    : adapter.rotateSession(request, 'id', 'old-jti', session),
            ).rejects.toBeInstanceOf(DependencyUnavailableException);
            expect(redis.eval).toHaveBeenCalledTimes(1);
        });
    });

    describe('error translation', () => {
        it.each(['Connection is closed.', 'Command timed out'])('should translate %s', async (message) => {
            redis.eval.mockRejectedValueOnce(new Error(message));
            await expect(adapter.setVersion('id', PrincipalType.USER, 1)).rejects.toBeInstanceOf(
                DependencyUnavailableException,
            );
        });

        it.each([
            'WRONGTYPE wrong key type',
            'NOAUTH Authentication required',
            'ERR invalid expire time',
            'ERR Lua script failure',
        ])('should preserve %s', async (message) => {
            const error = Object.assign(new Error(message), { name: 'ReplyError' });
            redis.eval.mockRejectedValueOnce(error);
            await expect(adapter.setVersion('id', PrincipalType.USER, 1)).rejects.toBe(error);
        });

        it('should preserve asynchronous programming errors', async () => {
            const error = new TypeError('Unexpected bug');
            redis.eval.mockRejectedValueOnce(error);
            await expect(adapter.setVersion('id', PrincipalType.USER, 1)).rejects.toBe(error);
        });

        it.each(['LOADING dataset', 'BUSY script', 'TRYAGAIN later'])('should translate %s', async (message) => {
            redis.eval.mockRejectedValueOnce(Object.assign(new Error(message), { name: 'ReplyError' }));
            await expect(adapter.setVersion('id', PrincipalType.USER, 1)).rejects.toBeInstanceOf(
                DependencyUnavailableException,
            );
        });
        it('should translate an asynchronous Redis rejection and preserve its cause', async () => {
            const driverError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

            redis.eval.mockRejectedValueOnce(driverError);

            const operation = adapter.setVersion('principal-id', PrincipalType.USER, 1);

            await expect(operation).rejects.toBeInstanceOf(DependencyUnavailableException);
            await expect(operation).rejects.toHaveProperty('cause', driverError);
        });

        it('should propagate an existing dependency exception unchanged', async () => {
            const dependencyError = new DependencyUnavailableException('Session store unavailable');

            redis.eval.mockRejectedValueOnce(dependencyError);

            await expect(adapter.setVersion('principal-id', PrincipalType.USER, 1)).rejects.toBe(dependencyError);
        });

        it('should propagate a synchronous error without translating it', async () => {
            const programmingError = new TypeError('Invalid Redis arguments');

            redis.eval.mockImplementationOnce(() => {
                throw programmingError;
            });

            await expect(adapter.setVersion('principal-id', PrincipalType.USER, 1)).rejects.toBe(programmingError);
        });
    });
});
