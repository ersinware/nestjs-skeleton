/**
 * @file cache-cleaner.adapter.ts
 * @description Implementation of Redis cache cleaning operations for end-to-end testing environments.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from 'src/core/cache/cache-client.token';
import type { ICacheCleanerPort } from 'src/core/cache/port/cache-cleaner.port';

/**
 * Redis cleaner utility flushing keys to reset the cache during test suites.
 */
@Injectable()
export class CacheCleanerAdapter implements ICacheCleanerPort {
    /**
     * Creates an instance of CacheCleanerAdapter.
     *
     * @param cacheRedis Configured cache Redis client instance.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) private readonly cacheRedis: Redis) {}

    /**
     * Flushes all keys from the cache Redis instance.
     */
    async cleanup() {
        await this.cacheRedis.flushall();
    }
}
