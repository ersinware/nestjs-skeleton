/**
 * @file redis-cleaner.service.ts
 * @description Implementation of Redis cache cleaning operations for end-to-end testing environments.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from '../constant/cache.constant';
import { ICacheCleanerService } from '../interface/cache-cleaner-service.interface';

/**
 * Redis cleaner utility flushing keys to reset cache states during test suites.
 */
@Injectable()
export class RedisCleanerService implements ICacheCleanerService {
    /**
     * Creates an instance of RedisCleanerService.
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
