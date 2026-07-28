/**
 * @file cache-health.adapter.ts
 * @description Implementation of Redis health verification using the configured client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import type { ICacheHealthPort } from 'src/core/cache/port/cache-health.port';

/**
 * Redis health indicator implementation that queries the client via ping to verify connection.
 */
@Injectable()
export class CacheHealthAdapter implements ICacheHealthPort {
    /**
     * Creates an instance of CacheHealthAdapter.
     *
     * @param cacheRedis Configured cache Redis client instance.
     */
    constructor(@Inject(TOKEN_CACHE_CONNECTION) private readonly cacheRedis: Redis) {}

    /**
     * Sends a ping query to verify connection to the cache Redis instance.
     */
    async ping() {
        await this.cacheRedis.ping();
    }
}
