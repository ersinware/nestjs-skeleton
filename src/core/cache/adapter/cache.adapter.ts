/**
 * @file cache.adapter.ts
 * @description Redis implementation of the ICachePort interface using ioredis client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from 'src/core/cache/cache-client.token';
import type { ICachePort } from 'src/core/cache/port/cache.port';
import { SystemException } from 'src/shared/exception';

const EMPTY_KEY_ERROR_MESSAGE = 'Cache key must be a non-empty string.';

/**
 * Redis-backed implementation of the cache port.
 *
 * Every Redis failure is swallowed and the operation degrades to a cache miss: the caller falls back
 * to its authoritative source, so the failure is fully self-healing per request. No logging or
 * capture here — detection is the health alarm's job and the per-outage transition log in
 * `redis-client.factory.ts` names the cause; a per-call record would only flood during an outage.
 * The only throw is `SystemException` on an empty key: a caller bug that must surface as 500 + Sentry.
 */
@Injectable()
export class CacheAdapter implements ICachePort {
    /**
     * Creates an instance of CacheAdapter.
     *
     * @param redis The injected Redis client.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) private readonly redis: Redis) {}

    /**
     * Gets a key's value from Redis, parsing JSON values automatically.
     *
     * @param key Cache key.
     * @returns The typed value if found, otherwise null.
     * @throws {SystemException} If the key is empty.
     */
    async get<T = string>(key: string): Promise<T | null> {
        if (!key) {
            throw new SystemException(EMPTY_KEY_ERROR_MESSAGE, {
                context: { class: this.constructor.name, method: this.get.name },
            });
        }

        try {
            const value = await this.redis.get(key);

            if (value === null) {
                return null;
            }

            return this.safeParse<T>(value) as T;
        } catch {
            // Fail-open: indistinguishable from a cache miss to the caller, which re-reads its source.
            return null;
        }
    }

    /**
     * Sets a key's value in Redis, serializing non-string values to JSON.
     *
     * @param key Cache key.
     * @param value Cache value.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @param useJitter Adds random variation to the TTL, spreading expirations to avoid stampedes.
     * @param jitterMaxPercent Maximum percentage of the TTL to add as jitter.
     * @throws {SystemException} If the key is empty.
     */
    async set(
        key: string,
        value: unknown,
        ttlSeconds?: number,
        { useJitter = false, jitterMaxPercent = 10 }: { useJitter?: boolean; jitterMaxPercent?: number } = {},
    ) {
        if (!key) {
            throw new SystemException(EMPTY_KEY_ERROR_MESSAGE, {
                context: { class: this.constructor.name, method: this.set.name },
            });
        }

        try {
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

            if (ttlSeconds !== undefined) {
                let finalTtl = ttlSeconds;

                if (useJitter) {
                    const maxJitter = Math.floor(ttlSeconds * (jitterMaxPercent / 100)),
                        jitter = Math.floor(Math.random() * maxJitter);

                    finalTtl = ttlSeconds + jitter;
                }

                await this.redis.set(key, stringValue, 'EX', finalTtl);
            } else {
                await this.redis.set(key, stringValue);
            }
        } catch {
            // Fail-open: the value simply isn't cached; the next read falls back to the source.
        }
    }

    /**
     * Deletes a key from Redis.
     *
     * @param key Cache key.
     * @throws {SystemException} If the key is empty.
     */
    async delete(key: string) {
        if (!key) {
            throw new SystemException(EMPTY_KEY_ERROR_MESSAGE, {
                context: { class: this.constructor.name, method: this.delete.name },
            });
        }

        try {
            await this.redis.del(key);
        } catch {
            // Fail-open: a stale entry outlives its invalidation but expires with its TTL.
        }
    }

    /**
     * Parses a JSON string, falling back to the raw string when it is not valid JSON —
     * plain-string values are stored unwrapped, so a parse failure is a normal outcome.
     *
     * @param value The string value to parse.
     * @returns The parsed value, or the original string.
     */
    private safeParse<T>(value: string): T | string {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
}
