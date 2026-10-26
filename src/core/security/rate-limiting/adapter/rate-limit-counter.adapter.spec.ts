/**
 * @file rate-limit-counter.adapter.spec.ts
 * @description Adapter timeout and error translation without reimplementing the store algorithm.
 */

import { RedisThrottlerStorage } from '@nestjs-redis/throttler-storage';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { ErrorReply, type RedisClientType } from 'redis';
import { RateLimitCounterAdapter } from 'src/core/security/rate-limiting/adapter/rate-limit-counter.adapter';
import { DependencyUnavailableException } from 'src/shared/exception';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Counter budget shared by adapter-boundary tests.
 */
const attempt = {
    key: 'api:rl:default-ip-short:192.0.2.1',

    limit: 2,
    windowSeconds: 60,
    blockDurationSeconds: 10,
};

/**
 * Creates a connection facade; only the package's admission boundary is mocked.
 *
 * @returns Adapter and connection event emitter.
 */
function setup() {
    const redis = Object.assign(new EventEmitter(), { isReady: true });
    const adapter = new RateLimitCounterAdapter(
        redis as unknown as RedisClientType,
        new ConfigService({ REDIS_RATE_LIMIT_COMMAND_TIMEOUT: 0.1, NODE_ENV: 'test', SERVICE_NAME: 'api' }),
    );
    return { redis, adapter };
}

describe('RateLimitCounterAdapter', () => {
    afterEach(() => vi.useRealTimers());

    it('converts seconds to package milliseconds and cleans up successful timers', async () => {
        vi.useFakeTimers();
        const increment = vi
            .spyOn(RedisThrottlerStorage.prototype, 'increment')
            .mockResolvedValue({ isBlocked: false, totalHits: 1, timeToExpire: 60, timeToBlockExpire: -1 });
        const { adapter } = setup();
        await expect(adapter.consume(attempt)).resolves.toEqual({ allowed: true });
        expect(increment).toHaveBeenCalledWith(attempt.key, 60000, 2, 10000, 'test:api:rate-limit');
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        [-1, 1],
        [0, 1],
        [7, 7],
    ])('maps block TTL %s to Retry-After %s', async (ttl, expected) => {
        vi.spyOn(RedisThrottlerStorage.prototype, 'increment').mockResolvedValue({
            isBlocked: true,
            totalHits: 3,
            timeToExpire: -1,
            timeToBlockExpire: ttl,
        });
        await expect(setup().adapter.consume(attempt)).resolves.toEqual({
            allowed: false,
            retryAfterSeconds: expected,
        });
    });

    it('fails closed when the response wait expires and never retries an uncertain operation', async () => {
        vi.useFakeTimers();
        const increment = vi.spyOn(RedisThrottlerStorage.prototype, 'increment').mockReturnValue(new Promise(() => {}));
        const pending = setup().adapter.consume(attempt);
        const rejection = expect(pending).rejects.toMatchObject({
            kind: 'DEPENDENCY_UNAVAILABLE',
            cause: { name: 'Error' },
        });
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        expect(increment).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not call storage while offline', async () => {
        const increment = vi.spyOn(RedisThrottlerStorage.prototype, 'increment');
        const { redis, adapter } = setup();
        redis.isReady = false;
        await expect(adapter.consume(attempt)).rejects.toBeInstanceOf(DependencyUnavailableException);
        expect(increment).not.toHaveBeenCalled();
    });

    it.each(['OOM command not allowed when used memory > maxmemory.', 'LOADING Redis is loading'])(
        'translates known availability failure %s preserving cause',
        async (message) => {
            const error = new ErrorReply(message);
            vi.spyOn(RedisThrottlerStorage.prototype, 'increment').mockRejectedValue(error);
            await expect(setup().adapter.consume(attempt)).rejects.toMatchObject({
                kind: 'DEPENDENCY_UNAVAILABLE',
                cause: error,
            });
        },
    );

    it.each([
        'WRONGPASS invalid username-password pair',
        'NOPERM this user has no permissions',
        'ERR Error running script',
    ])('preserves actionable store failure %s', async (message) => {
        const error = new ErrorReply(message);
        vi.spyOn(RedisThrottlerStorage.prototype, 'increment').mockRejectedValue(error);
        await expect(setup().adapter.consume(attempt)).rejects.toBe(error);
    });

    it('preserves setup faults until a ready event clears them', async () => {
        const { redis, adapter } = setup();
        const fault = new ErrorReply('WRONGPASS bad credentials');
        redis.isReady = false;
        redis.emit('error', fault);
        await expect(adapter.consume(attempt)).rejects.toBe(fault);
        redis.emit('ready');
        await expect(adapter.consume(attempt)).rejects.toBeInstanceOf(DependencyUnavailableException);
    });
});
