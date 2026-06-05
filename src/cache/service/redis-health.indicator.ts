/**
 * @file redis-health.indicator.ts
 * @description Implementation of Redis health verification using the configured client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import type { ICacheHealthIndicator } from '../interface/cache-health-indicator.interface';

/**
 * Redis health indicator implementation that queries the client via ping to verify connection.
 */
@Injectable()
export class RedisHealthIndicator implements ICacheHealthIndicator {
    /**
     * Creates an instance of RedisHealthIndicator.
     *
     * @param redis Configured Redis client instance.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) private readonly redis: Redis) {}

    /**
     * Sends a ping query to verify connection to Redis.
     *
     */
    async ping() {
        await this.redis.ping();
    }
}
