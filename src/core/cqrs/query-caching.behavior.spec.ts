/**
 * @file query-caching.behavior.spec.ts
 * @description Regression coverage for detached cache writes and their failure reporting.
 */

import { Query } from '@nestjs/cqrs';
import { QueryCachingBehavior, type ICacheableQuery } from 'src/core/cqrs/query-caching.behavior';
import { SystemException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A cacheable query with a fixed key for background-write assertions. */
class CachedQuery extends Query<string> implements ICacheableQuery {
    readonly cacheTtlSeconds = 60;

    /** Identifies the cached test result. */
    cacheKey(): string {
        return 'test:query';
    }
}

describe('QueryCachingBehavior background writes', () => {
    const cache = {
            get: vi.fn<() => Promise<null>>().mockResolvedValue(null),
            set: vi.fn<() => Promise<void>>(),
            delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        },
        logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        tracker = { captureException: vi.fn() },
        next = vi.fn<() => Promise<string>>().mockResolvedValue('result');

    let behavior: QueryCachingBehavior;

    beforeEach(() => {
        behavior = new QueryCachingBehavior(cache, logger, tracker);
    });

    it('returns the query result before the cache write settles and reports a later rejection', async () => {
        let rejectWrite!: (error: unknown) => void;

        const write = new Promise<void>((_resolve, reject) => {
                rejectWrite = reject;
            }),
            error = new SystemException('Cache serialization failed.', {
                context: { class: 'CacheAdapter', method: 'set' },
            });

        cache.set.mockReturnValueOnce(write);

        await expect(behavior.execute(new CachedQuery(), next)).resolves.toBe('result');

        expect(cache.get).toHaveBeenCalledWith('test:query');
        expect(next).toHaveBeenCalledWith();
        expect(cache.set).toHaveBeenCalledWith('test:query', 'result', 60, { useJitter: true });
        expect(cache.get.mock.invocationCallOrder[0]).toBeLessThan(next.mock.invocationCallOrder[0]!);
        expect(next.mock.invocationCallOrder[0]).toBeLessThan(cache.set.mock.invocationCallOrder[0]!);
        expect(logger.error).not.toHaveBeenCalled();

        rejectWrite(error);
        await Promise.resolve();

        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                class: 'QueryCachingBehavior',
                method: 'execute',
                error,
                data: { context: error.context },
            }),
        );
        expect(tracker.captureException).toHaveBeenCalledWith(error);
        expect(logger.error.mock.invocationCallOrder[0]).toBeLessThan(
            tracker.captureException.mock.invocationCallOrder[0]!,
        );
    });

    it('does not report a successfully settled background write', async () => {
        cache.set.mockResolvedValueOnce(undefined);

        await expect(behavior.execute(new CachedQuery(), next)).resolves.toBe('result');

        expect(cache.set).toHaveBeenCalledWith('test:query', 'result', 60, { useJitter: true });
        expect(logger.error).not.toHaveBeenCalled();
    });
});
