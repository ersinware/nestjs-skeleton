/**
 * @file cache-eviction.adapter.ts
 * @description Redis cache eviction that propagates failures to event consumers.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import type { ICacheEvictionPort } from 'src/core/cache/port/cache-eviction.port';
import { SystemException } from 'src/shared/exception';

/** Exposes failed deletions to the delivery owner without per-attempt logging. */
@Injectable()
export class CacheEvictionAdapter implements ICacheEvictionPort {
    /**
     * Shares the cache concern's Redis connection.
     *
     * @param redis The cache Redis client.
     */
    constructor(@Inject(TOKEN_CACHE_CONNECTION) private readonly redis: Redis) {}

    /**
     * Awaits deletion so a failed attempt cannot appear completed.
     *
     * @param key Cache key.
     */
    async delete(key: string) {
        if (!key) {
            throw new SystemException('Cache key must be a non-empty string.', {
                context: { class: this.constructor.name, method: this.delete.name },
            });
        }

        await this.redis.del(key);
    }
}
