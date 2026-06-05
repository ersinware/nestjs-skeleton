/**
 * @file redis-cleaner.service.ts
 * @description Implementation of Redis cache cleaning operations for end-to-end testing environments.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import { ICacheCleaner } from '../interface/cache-cleaner.interface';

/**
 * Redis cleaner utility flushing keys to reset cache states during test suites.
 */
@Injectable()
export class RedisCleaner implements ICacheCleaner {
    /**
     * Creates an instance of RedisCleaner.
     *
     * @param redis Configured Redis client instance.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) private readonly redis: Redis) {}

    /**
     * Flushes all keys from Redis cache.
     *
     */
    async cleanup() {
        await this.redis.flushall();
    }
}
