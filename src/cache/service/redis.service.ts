/**
 * @file redis.service.ts
 * @description Redis implementation of the ICacheService interface using ioredis client.
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { LogPayload } from 'src/common/logger/log-payload';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import type { ICacheService } from '../interface/cache-service.interface';

const ERROR_MESSAGE_EMPTY_KEY = 'Cache key must be a non-empty string.';

/**
 * Service managing cache operations backed by Redis client.
 */
@Injectable()
export class RedisService implements ICacheService {
    /**
     * Creates an instance of RedisService.
     *
     * @param redis The injected Redis client.
     * @param logger The injected Logger service.
     */
    constructor(
        @Inject(TOKEN_CACHE_CLIENT) protected readonly redis: Redis,
        private readonly logger: Logger,
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

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.get.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);

            return null;
        }
    }

    /**
     * Sets a key's value in Redis, serializing objects and stripping sensitive properties automatically.
     * If a JSON-serialized string is provided, it is first parsed and sanitized to prevent nested sensitive
     * properties (e.g., password hashes, secrets) from leaking into the cache.
     *
     * @param key Cache key.
     * @param value Cache value.
     * @param ttlSeconds Optional time-to-live in seconds.
     * @throws {Error} if key is empty.
     */
    async set(key: string, value: unknown, ttlSeconds?: number) {
        if (!key) {
            throw new Error(ERROR_MESSAGE_EMPTY_KEY);
        }

        try {
            let stringValue: string;

            if (typeof value === 'string') {
                const parsed = this.safeParse(value);

                if (typeof parsed === 'string') {
                    stringValue = value;
                } else {
                    stringValue = JSON.stringify(this.sanitize(parsed));
                }
            } else {
                stringValue = JSON.stringify(this.sanitize(value));
            }

            if (ttlSeconds !== undefined) {
                await this.redis.set(key, stringValue, 'EX', ttlSeconds);
            } else {
                await this.redis.set(key, stringValue);
            }
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.set.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);
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

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.delete.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);
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

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.deletePattern.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);
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

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.exists.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);

            return false;
        }
    }

    /**
     * Recursively removes sensitive properties from an object or array.
     *
     * @param val The value to sanitize.
     * @returns The sanitized value.
     */
    private sanitize(val: unknown): unknown {
        if (val === null || val === undefined) {
            return val;
        }

        if (Array.isArray(val)) {
            return val.map((item) => this.sanitize(item));
        }

        if (typeof val === 'object') {
            const cleaned: Record<string, unknown> = {};

            for (const key of Object.keys(val)) {
                const lowerKey = key.toLowerCase();

                if (
                    lowerKey === 'password' ||
                    lowerKey === 'passwordhash' ||
                    lowerKey === 'salt' ||
                    lowerKey === 'secret'
                ) {
                    continue;
                }

                cleaned[key] = this.sanitize((val as Record<string, unknown>)[key]);
            }

            return cleaned;
        }

        return val;
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
