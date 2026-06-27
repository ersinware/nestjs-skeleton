/**
 * @file redis-health.indicator.ts
 * @description Implementation of Redis health verification using the configured client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from 'src/common/port/cache/cache.constant';
import type { ICacheHealthIndicator } from 'src/common/port/cache/cache-health-indicator.interface';

/**
 * Redis health indicator implementation that queries the client via ping to verify connection.
 */
@Injectable()
export class RedisHealthIndicator implements ICacheHealthIndicator {
    /**
     * Creates an instance of RedisHealthIndicator.
     *
     * @param cacheRedis Configured Cache Redis client instance.
     * @param stateRedis Configured State Redis client instance.
     */
    constructor(
        @Inject(TOKEN_CACHE_CLIENT) private readonly cacheRedis: Redis,
        @Inject(TOKEN_CACHE_STATE_CLIENT) private readonly stateRedis: Redis,
    ) {}

    /**
     * Sends a ping query to verify connection to both Redis instances.
     *
     */
    async ping() {
        await Promise.all([this.cacheRedis.ping(), this.stateRedis.ping()]);
    }
}
