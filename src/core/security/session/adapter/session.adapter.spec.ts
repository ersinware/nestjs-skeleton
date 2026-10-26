/**
 * @file session.adapter.spec.ts
 * @description Verifies principal key colocation and session-store error translation at the Redis boundary.
 */

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ENV } from 'src/core/config';
import { SessionAdapter } from 'src/core/security/session/adapter/session.adapter';
import type { SessionRegistration } from 'src/core/security/session/port/session.port';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SessionAdapter', () => {
    const redis = {
        eval: vi.fn(),
        del: vi.fn(),
        get: vi.fn(),
    };

    let adapter: SessionAdapter;

    beforeEach(() => {
        const configService = new ConfigService({
            [ENV.JWT_REFRESH_TTL]: '7d',
            [ENV.JWT_ACCESS_TTL]: '15m',
            [ENV.SESSION_ROTATION_GRACE_TTL]: '30s',
        });

        adapter = new SessionAdapter(redis as unknown as Redis, configService);
    });

    it('translates an unavailable session deletion without reporting logout success', async () => {
        redis.del.mockRejectedValueOnce(new Error('Connection is closed.'));
        await expect(adapter.closeSession('id', PrincipalType.USER, 'sid')).rejects.toBeInstanceOf(
            DependencyUnavailableException,
        );
    });

    describe.each(Object.values(PrincipalType))('%s namespace', (principalType) => {
        it('passes the same complete principal hash tag to every Lua script', async () => {
            const session: SessionRegistration = {
                principalType,
                sid: 'sid',
                refreshTokenJti: 'new-jti',
                sessionVersion: 1,
                sessionExpiresAt: 2_000_000_000,
                refreshExpiresAt: 2_000_000_000,
            };
            redis.eval.mockResolvedValue(1);
            await adapter.openSession('id', session);
            await adapter.rotateSession('id', 'old-jti', session);
            await adapter.isSessionActive('id', principalType, 'sid', 1);
            await adapter.setVersion('id', principalType, 2);

            const prefix = `auth:{${principalType}:id}`;
            const keysByScript = redis.eval.mock.calls.map(([, count, ...args]) =>
                args.slice(0, Number(count)).map(String),
            );
            expect(keysByScript).toEqual([
                [`${prefix}:version`, `${prefix}:session:sid`],
                [`${prefix}:session:sid`, `${prefix}:rotated:sid:old-jti`, `${prefix}:version`],
                [`${prefix}:version`, `${prefix}:session:sid`],
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
            expect(redis.del).toHaveBeenCalledWith(`auth:{${principalType}:id}:session:sid`);
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
