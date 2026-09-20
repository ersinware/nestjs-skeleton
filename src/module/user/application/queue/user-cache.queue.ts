/**
 * @file user-cache.queue.ts
 * @description Invalidates cached user projections from durable jobs.
 */

import { Inject, Injectable } from '@nestjs/common';
import { TOKEN_CACHE_EVICTION_PORT, type ICacheEvictionPort } from 'src/core/cache';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Consumes durable user cache invalidation jobs.
 */
@Injectable()
export class UserCacheQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.CACHE_INVALIDATE;

    /**
     * Redis cache eviction cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Initializes the consumer with the cache eviction port.
     *
     * @param cacheEvictionPort Cache eviction contract whose failures trigger job retry
     */
    constructor(@Inject(TOKEN_CACHE_EVICTION_PORT) private readonly cacheEvictionPort: ICacheEvictionPort) {}

    /**
     * Evicts the cached projection for the referenced user.
     *
     * @param job Cache invalidation job
     */
    async consume(job: Job) {
        await this.cacheEvictionPort.delete(CacheKeys.userById(job.aggregateId));
    }
}
