/**
 * @file redis-cache.service.ts
 * @description Redis implementation of the ICacheService interface using ioredis client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import type { ICacheService } from '../interface/cache-service.interface';

const ERROR_MESSAGE_EMPTY_KEY = 'Cache key must be a non-empty string.';

/**
 * Service managing cache operations backed by Redis client.
 */
@Injectable()
export class RedisCacheService implements ICacheService {
    /**
     * Creates an instance of RedisCacheService.
     *
     * @param redis The injected Redis client.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) private readonly redis: Redis) {}

    /**
     * Gets a key's value from Redis.
     *
     * @param key Cache key.
     * @returns A promise resolving to the value if found, otherwise null.
     * @throws {Error} if key is empty.
     */
    async get(key: string): Promise<string | null> {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
        }

        return this.redis.get(key);
    }

    /**
     * Sets a key's value in Redis with optional expiration time.
     *
     * @param key Cache key.
     * @param value Cache value.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @throws {Error} if key is empty.
     */
    async set(key: string, value: string, ttlSeconds?: number) {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
        }

        if (ttlSeconds !== undefined) {
            await this.redis.set(key, value, 'EX', ttlSeconds);
        } else {
            await this.redis.set(key, value);
        }
    }

    /**
     * Deletes a key from Redis.
     *
     * @param key Cache key.
     * @throws {Error} if key is empty.
     */
    async delete(key: string) {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
        }

        await this.redis.del(key);
    }

    /**
     * Deletes all keys matching a specific pattern cursor-by-cursor using SCAN.
     *
     * @param pattern Glob-style key pattern.
     * @throws {Error} if pattern is empty.
     */
    async deletePattern(pattern: string) {
        if (!pattern) {
            throw new Error('Cache pattern must be a non-empty string.');
        }

        let cursor = '0';

        do {
            const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;

            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } while (cursor !== '0');
    }

    /**
     * Checks if a key exists in Redis.
     *
     * @param key Cache key.
     * @returns A promise resolving to true if key exists, otherwise false.
     * @throws {Error} if key is empty.
     */
    async exists(key: string): Promise<boolean> {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
        }

        return (await this.redis.exists(key)) > 0;
    }
}
