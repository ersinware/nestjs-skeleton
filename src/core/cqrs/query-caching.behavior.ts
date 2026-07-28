/**
 * @file query-caching.behavior.ts
 * @description Query pipeline behavior implementing the cache-aside read pattern once, for every
 * query that opts in, so no handler carries get/miss/set boilerplate or a private TTL.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { IQuery } from '@nestjs/cqrs';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import type { IQueryBehavior } from 'src/core/cqrs/query.pipeline';

/**
 * A query that participates in the read cache. Caching is a property of the QUERY, never of the
 * caller: the same query caches wherever it is dispatched, and a query that must never be served
 * stale simply does not implement this.
 */
export interface ICacheableQuery {
    /**
     * The cache key uniquely identifying this query's result.
     *
     * @returns The fully-qualified cache key
     */
    cacheKey(): string;

    /** Time-to-live for the cached result, in seconds. */
    readonly cacheTtlSeconds: number;
}

/**
 * Narrows a dispatched query to one that opts into caching.
 *
 * @param query The query under inspection
 * @returns True when the query implements the cacheable contract
 */
function isCacheableQuery(query: IQuery): query is IQuery & ICacheableQuery {
    return typeof (query as Partial<ICacheableQuery>).cacheKey === 'function';
}

/**
 * Serves cacheable queries from the cache, populating it on a miss. Non-cacheable queries pass
 * straight through. The populate write is fire-and-forget with TTL jitter (anti-stampede); a miss
 * that throws (e.g. not-found) propagates and is never cached.
 */
@Injectable()
export class QueryCachingBehavior implements IQueryBehavior {
    /**
     * @param cachePort The cache the behavior reads and populates
     */
    constructor(@Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort) {}

    /**
     * Applies cache-aside around the rest of the pipeline for cacheable queries.
     *
     * @param query The dispatched query
     * @param next Invokes the remainder of the pipeline (ultimately the handler)
     * @returns The cached result on a hit, otherwise the freshly computed and cached result
     */
    async execute<TResult>(query: IQuery, next: () => Promise<TResult>): Promise<TResult> {
        if (!isCacheableQuery(query)) {
            return next();
        }

        const key = query.cacheKey(),
            cached = await this.cachePort.get<TResult>(key);

        if (cached !== null) {
            return cached;
        }

        const result = await next();

        void this.cachePort.set(key, result, query.cacheTtlSeconds, { useJitter: true });

        return result;
    }
}
