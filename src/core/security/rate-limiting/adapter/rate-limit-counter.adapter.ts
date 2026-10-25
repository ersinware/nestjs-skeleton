/**
 * @file rate-limit-counter.adapter.ts
 * @description Adapts the ready-made Redis Sliding Window Counter to the project admission contract.
 */

import { RedisThrottlerStorage, ThrottlerAlgorithm } from '@nestjs-redis/throttler-storage';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { TimeoutError, type RedisClientType } from 'redis';
import { ENV } from 'src/core/config';
import { isNodeRedisUnavailable } from 'src/core/redis';
import type {
    IRateLimitCounterPort,
    RateLimitCounterAttempt,
    RateLimitCounterResult,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { TOKEN_RATE_LIMIT_CONNECTION } from 'src/core/security/rate-limiting/rate-limit-connection.token';
import { DependencyUnavailableException, DependencyUnavailableMessage } from 'src/shared/exception';

/**
 * Retains the package's script cache and bounds each counter admission attempt.
 * No counter algorithm or Lua is implemented here.
 */
@Injectable()
export class RateLimitCounterAdapter implements IRateLimitCounterPort {
    /**
     * A connection setup fault must not disappear behind the generic not-ready 503 path.
     */
    private connectionFault: Error | undefined;

    /**
     * Maximum wait for a complete storage increment, in milliseconds.
     */
    private readonly timeoutMs: number;

    /**
     * Official storage contract implemented by the selected community Redis adapter.
     */
    private readonly storage: ThrottlerStorage;

    /**
     * Connects the storage adapter to the dedicated Redis client and operation timeout.
     *
     * @param redis Dedicated node-redis connection owned by the rate-limit module.
     * @param config Validated counter-operation timeout configuration.
     */
    constructor(
        @Inject(TOKEN_RATE_LIMIT_CONNECTION) private readonly redis: RedisClientType,
        config: ConfigService,
    ) {
        redis.on('ready', () => {
            this.connectionFault = undefined;
        });

        redis.on('error', (error: Error) => {
            this.connectionFault = isNodeRedisUnavailable(error) ? undefined : error;
        });

        this.timeoutMs = config.getOrThrow<number>(ENV.REDIS_RATE_LIMIT_COMMAND_TIMEOUT) * 1000;
        this.storage = new RedisThrottlerStorage(redis, ThrottlerAlgorithm.SlidingWindowCounter);
    }

    /**
     * Consumes one counter budget, bounding the wait and translating known storage outages.
     *
     * @param attempt Counter identity and budget.
     * @returns The admission decision or remaining block duration.
     */
    async consume(attempt: RateLimitCounterAttempt): Promise<RateLimitCounterResult> {
        this.requireReady();

        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
            // Timeout ends this wait; the package operation can still continue in the background.
            const { isBlocked, timeToBlockExpire } = await Promise.race([
                this.storage.increment(
                    attempt.key,
                    attempt.windowSeconds * 1000,
                    attempt.limit,
                    attempt.blockDurationSeconds * 1000,
                    attempt.limiterName,
                ),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new TimeoutError()), this.timeoutMs);
                }),
            ]);

            if (!isBlocked) {
                return { allowed: true };
            }

            // PTTL can be zero at the expiry boundary; the package represents non-positive TTL as -1.
            return { allowed: false, retryAfterSeconds: Math.max(1, timeToBlockExpire) };
        } catch (error) {
            if (isNodeRedisUnavailable(error)) {
                throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
            }

            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Preserves actionable connection setup faults while failing closed on ordinary outages.
     *
     * @throws {DependencyUnavailableException} When the counter connection is not ready.
     */
    private requireReady() {
        if (!this.redis.isReady) {
            if (this.connectionFault) {
                throw this.connectionFault;
            }

            throw new DependencyUnavailableException();
        }
    }
}
