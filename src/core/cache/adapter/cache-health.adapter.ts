/**
 * @file cache-health.adapter.ts
 * @description Implementation of Redis health verification using the configured client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache/constant/constant';
import type { ICacheHealthPort } from 'src/core/cache/port/cache-health.port';

/**
 * Redis health indicator implementation that queries the client via ping to verify connection.
 */
@Injectable()
export class CacheHealthAdapter implements ICacheHealthPort {
    /**
     * Creates an instance of CacheHealthAdapter.
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
