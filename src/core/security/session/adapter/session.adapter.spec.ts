/**
 * @file session.adapter.spec.ts
 * @description Unit tests for session-store error translation at the Redis boundary.
 */

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ENV } from 'src/core/config';
import { SessionAdapter } from 'src/core/security/session/adapter/session.adapter';
import { DependencyUnavailableException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SessionAdapter', () => {
    const redis = {
        set: vi.fn(),
    };

    let adapter: SessionAdapter;

    beforeEach(() => {
        vi.clearAllMocks();

        const configService = new ConfigService({
            [ENV.JWT_REFRESH_TTL]: '7d',
            [ENV.SESSION_ROTATION_GRACE_TTL]: '30s',
        });

        adapter = new SessionAdapter(redis as unknown as Redis, configService);
    });

    describe('error translation', () => {
        it.each(['Connection is closed.', 'Command timed out'])('should translate %s', async (message) => {
            redis.set.mockRejectedValueOnce(new Error(message));
            await expect(adapter.openSession('id', 'jti')).rejects.toBeInstanceOf(DependencyUnavailableException);
        });

        it.each([
            'WRONGTYPE wrong key type',
            'NOAUTH Authentication required',
            'ERR invalid expire time',
            'ERR Lua script failure',
        ])('should preserve %s', async (message) => {
            const error = Object.assign(new Error(message), { name: 'ReplyError' });
            redis.set.mockRejectedValueOnce(error);
            await expect(adapter.openSession('id', 'jti')).rejects.toBe(error);
        });

        it('should preserve asynchronous programming errors', async () => {
            const error = new TypeError('Unexpected bug');
            redis.set.mockRejectedValueOnce(error);
            await expect(adapter.openSession('id', 'jti')).rejects.toBe(error);
        });

        it.each(['LOADING dataset', 'BUSY script', 'TRYAGAIN later'])('should translate %s', async (message) => {
            redis.set.mockRejectedValueOnce(Object.assign(new Error(message), { name: 'ReplyError' }));
            await expect(adapter.openSession('id', 'jti')).rejects.toBeInstanceOf(DependencyUnavailableException);
        });
        it('should translate an asynchronous Redis rejection and preserve its cause', async () => {
            const driverError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

            redis.set.mockRejectedValueOnce(driverError);

            const operation = adapter.openSession('principal-id', 'refresh-token-id');

            await expect(operation).rejects.toBeInstanceOf(DependencyUnavailableException);
            await expect(operation).rejects.toHaveProperty('cause', driverError);
        });

        it('should propagate an existing dependency exception unchanged', async () => {
            const dependencyError = new DependencyUnavailableException('Session store unavailable');

            redis.set.mockRejectedValueOnce(dependencyError);

            await expect(adapter.openSession('principal-id', 'refresh-token-id')).rejects.toBe(dependencyError);
        });

        it('should propagate a synchronous error without translating it', async () => {
            const programmingError = new TypeError('Invalid Redis arguments');

            redis.set.mockImplementationOnce(() => {
                throw programmingError;
            });

            await expect(adapter.openSession('principal-id', 'refresh-token-id')).rejects.toBe(programmingError);
        });
    });
});
