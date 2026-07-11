/**
 * @file cache.adapter.ts
 * @description Redis implementation of the ICachePort interface using ioredis client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from 'src/core/cache/constant/constant';
import type { ICachePort } from 'src/core/cache/port/cache.port';
import {
    LogPayload,
    TOKEN_EXCEPTION_TRACKER_PORT,
    TOKEN_LOGGER_PORT,
    type IExceptionTrackerPort,
    type ILoggerPort,
} from 'src/core/observability';

const ERROR_MESSAGE_EMPTY_KEY = 'Cache key must be a non-empty string.';

/**
 * Service managing cache operations backed by Redis client.
 */
@Injectable()
export class CacheAdapter implements ICachePort {
    /**
     * Creates an instance of CacheAdapter.
     *
     * @param redis The injected Redis client.
     * @param logger The injected Logger service.
     */
    constructor(
        @Inject(TOKEN_CACHE_CLIENT) protected readonly redis: Redis,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
    ) {}

    /**
     * Gets a key's value from Redis, automatically parsing JSON values if applicable.
     *
     * @param key Cache key.
     * @returns A promise resolving to the typed value if found, otherwise null.
     * @throws {Error} if key is empty.
     */
    async get<T = string>(key: string): Promise<T | null> {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
        }

        try {
            const value = await this.redis.get(key);
            if (value === null) {
                return null;
            }

            return this.safeParse<T>(value) as T;
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.loggerPort.error(this.createLogPayload(this.get.name, _error));
            this.exceptionTrackerPort.captureException(_error);

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
     * @throws {Error} if key is empty.
     */
    async set(
        key: string,
        value: unknown,
        ttlSeconds?: number,
        options?: { useJitter?: boolean; jitterMaxPercent?: number },
    ) {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
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
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.loggerPort.error(this.createLogPayload(this.set.name, _error));
            this.exceptionTrackerPort.captureException(_error);
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

        try {
            await this.redis.del(key);
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.loggerPort.error(this.createLogPayload(this.delete.name, _error));
            this.exceptionTrackerPort.captureException(_error);
        }
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

        try {
            let cursor = '0';

            do {
                const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;

                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            } while (cursor !== '0');
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.loggerPort.error(this.createLogPayload(this.deletePattern.name, _error));
            this.exceptionTrackerPort.captureException(_error);
        }
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

        try {
            return (await this.redis.exists(key)) > 0;
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.loggerPort.error(this.createLogPayload(this.exists.name, _error));
            this.exceptionTrackerPort.captureException(_error);

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

    /**
     * Creates a standardized log payload for the Redis service.
     */
    private createLogPayload(method: string, error: Error): LogPayload {
        return new LogPayload({
            class: this.constructor.name,
            method,
            error,
        });
    }
}
