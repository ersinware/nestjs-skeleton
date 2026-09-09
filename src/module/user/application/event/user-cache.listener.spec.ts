/**
 * @file user-cache.listener.spec.ts
 * @description Regression coverage for awaited event eviction and failure propagation.
 */

import { Test } from '@nestjs/testing';
import { TOKEN_CACHE_EVICTION_PORT } from 'src/core/cache';
import { UserCacheListener } from 'src/module/user/application/event/user-cache.listener';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('UserCacheListener', () => {
    let listener: UserCacheListener;
    const eviction = { delete: vi.fn() };
    const event = { aggregateId: 'user-id', eventId: 'event-id' };

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [UserCacheListener, { provide: TOKEN_CACHE_EVICTION_PORT, useValue: eviction }],
        }).compile();

        listener = module.get(UserCacheListener);
    });

    it('waits for eviction and propagates its eventual failure', async () => {
        let rejectEviction!: (reason: Error) => void;
        eviction.delete.mockReturnValueOnce(
            new Promise<void>((_, reject) => {
                rejectEviction = reject;
            }),
        );
        const completed = vi.fn();
        const error = new Error('Redis unavailable');
        const delivery = listener.invalidateProfile(event).then(completed);
        const rejection = expect(delivery).rejects.toBe(error);

        await Promise.resolve();
        expect(eviction.delete).toHaveBeenCalledWith(CacheKeys.userById(event.aggregateId));
        expect(completed).not.toHaveBeenCalled();

        rejectEviction(error);
        await rejection;
        expect(completed).not.toHaveBeenCalled();
    });

    it('allows repeated successful eviction of the same event', async () => {
        eviction.delete.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

        await expect(listener.invalidateProfile(event)).resolves.toBeUndefined();
        expect(eviction.delete).toHaveBeenCalledWith(CacheKeys.userById(event.aggregateId));
        await expect(listener.invalidateProfile(event)).resolves.toBeUndefined();
        expect(eviction.delete).toHaveBeenNthCalledWith(2, CacheKeys.userById(event.aggregateId));
    });
});
