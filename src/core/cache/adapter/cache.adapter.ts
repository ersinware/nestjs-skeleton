/**
 * @file cache.adapter.ts
 * @description Redis implementation of the ICachePort interface using ioredis client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from 'src/core/cache/cache-client.token';
import type { ICachePort } from 'src/core/cache/port/cache.port';
import { SystemException } from 'src/shared/exception';

const ERROR_MESSAGE_EMPTY_KEY = 'Cache key must be a non-empty string.';

/**
 * Service managing cache operations backed by Redis client.
 *
 * Every Redis failure is swallowed and the operation degrades to a cache miss: the caller falls back
 * to its authoritative source, so the failure is fully self-healing per request. No logging or
 * capture here — detection is the health alarm's job and the per-outage connection transition log in
 * `core/cache/module.ts` names the cause; a per-call record would only flood during an outage.
 */
@Injectable()
export class CacheAdapter implements ICachePort {
    /**
     * Creates an instance of CacheAdapter.
     *
     * @param redis The injected Redis client.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) protected readonly redis: Redis) {}

    /**
     * Gets a key's value from Redis, automatically parsing JSON values if applicable.
     *
     * @param key Cache key.
     * @returns A promise resolving to the typed value if found, otherwise null.
     * @throws {SystemException} if key is empty.
     */
    async get<T = string>(key: string): Promise<T | null> {
        if (!key) {
            throw new SystemException(ERROR_MESSAGE_EMPTY_KEY, {
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
     * Sets a key's value in Redis, serializing objects automatically.
     *
     * @param key Cache key.
     * @param value Cache value.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @param options Optional configuration parameters.
     * @throws {SystemException} if key is empty.
     */
    async set(
        key: string,
        value: unknown,
        ttlSeconds?: number,
        options?: { useJitter?: boolean; jitterMaxPercent?: number },
    ) {
        if (!key) {
            throw new SystemException(ERROR_MESSAGE_EMPTY_KEY, {
                context: { class: this.constructor.name, method: this.set.name },
            });
        }

        try {
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

            if (ttlSeconds !== undefined) {
                let finalTtl = ttlSeconds;

                if (options?.useJitter) {
                    const maxPercent = options.jitterMaxPercent ?? 10,
                        maxJitter = Math.floor(ttlSeconds * (maxPercent / 100)),
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
     * @throws {SystemException} if key is empty.
     */
    async delete(key: string) {
        if (!key) {
            throw new SystemException(ERROR_MESSAGE_EMPTY_KEY, {
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
     * Deletes all keys matching a specific pattern cursor-by-cursor using SCAN.
     *
     * @param pattern Glob-style key pattern.
     * @throws {SystemException} if pattern is empty.
     */
    async deletePattern(pattern: string) {
        if (!pattern) {
            throw new SystemException('Cache pattern must be a non-empty string.', {
                context: { class: this.constructor.name, method: this.deletePattern.name },
            });
        }

        try {
            let cursor = '0';

            do {
                const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;

                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            } while (cursor !== '0');
        } catch {
            // Fail-open: unswept entries outlive their invalidation but expire with their TTLs.
        }
    }

    /**
     * Checks if a key exists in Redis.
     *
     * @param key Cache key.
     * @returns A promise resolving to true if key exists, otherwise false.
     * @throws {SystemException} if key is empty.
     */
    async exists(key: string): Promise<boolean> {
        if (!key) {
            throw new SystemException(ERROR_MESSAGE_EMPTY_KEY, {
                context: { class: this.constructor.name, method: this.exists.name },
            });
        }

        try {
            return (await this.redis.exists(key)) > 0;
        } catch {
            // Fail-open: reported as absent, so the caller re-derives from its source.
            return false;
        }
    }

    /**
     * Safely parses a JSON string, falling back to the raw string if parsing fails.
     *
     * @param value The string value to parse.
     * @returns The parsed object/primitive or the original string.
     */
    private safeParse<T>(value: string): T | string {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
}
