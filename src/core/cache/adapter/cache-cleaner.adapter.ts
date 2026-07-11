/**
 * @file cache-cleaner.adapter.ts
 * @description Implementation of Redis cache cleaning operations for end-to-end testing environments.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache/constant/constant';
import type { ICacheCleanerPort } from 'src/core/cache/port';

/**
 * Redis cleaner utility flushing keys to reset cache states during test suites.
 */
@Injectable()
export class CacheCleanerAdapter implements ICacheCleanerPort {
    /**
     * Creates an instance of CacheCleanerAdapter.
     *
     * @param cacheRedis Configured Cache Redis client instance.
     * @param stateRedis Configured State Redis client instance.
     */
    constructor(
        @Inject(TOKEN_CACHE_CLIENT) private readonly cacheRedis: Redis,
        @Inject(TOKEN_CACHE_STATE_CLIENT) private readonly stateRedis: Redis,
    ) {}

    /**
     * Flushes all keys from Redis cache and state instances.
     *
     */
    async cleanup() {
        await Promise.all([this.cacheRedis.flushall(), this.stateRedis.flushall()]);
    }
}
