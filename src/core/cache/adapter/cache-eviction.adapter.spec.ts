/**
 * @file cache-eviction.adapter.spec.ts
 * @description Regression coverage for observable Redis eviction failures.
 */

import { Test } from '@nestjs/testing';
import { CacheEvictionAdapter } from 'src/core/cache/adapter/cache-eviction.adapter';
import { CacheAdapter } from 'src/core/cache/adapter/cache.adapter';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import { SystemException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheEvictionAdapter', () => {
    let adapter: CacheEvictionAdapter;
    let requestCache: CacheAdapter;
    const redis = { del: vi.fn() };

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [CacheEvictionAdapter, CacheAdapter, { provide: TOKEN_CACHE_CONNECTION, useValue: redis }],
        }).compile();

        adapter = module.get(CacheEvictionAdapter);
        requestCache = module.get(CacheAdapter);
    });

    it.each([0, 1])('accepts deletion of absent or existing keys (Redis result: %i)', async (result) => {
        redis.del.mockResolvedValueOnce(result);

        await expect(adapter.delete('profile')).resolves.toBeUndefined();
        expect(redis.del).toHaveBeenCalledWith('profile');
    });

    it('propagates the original failure while request eviction still fails open', async () => {
        const error = new Error('Connection is closed.');
        redis.del.mockRejectedValueOnce(error).mockRejectedValueOnce(error);

        await expect(adapter.delete('profile')).rejects.toBe(error);
        expect(redis.del).toHaveBeenCalledWith('profile');
        await expect(requestCache.delete('profile')).resolves.toBeUndefined();
        expect(redis.del).toHaveBeenNthCalledWith(2, 'profile');
    });

    it('propagates synchronous client errors', async () => {
        const error = new Error('Invalid client state');
        redis.del.mockImplementationOnce(() => {
            throw error;
        });

        await expect(adapter.delete('profile')).rejects.toBe(error);
        expect(redis.del).toHaveBeenCalledWith('profile');
    });

    it('rejects an empty key before calling Redis', async () => {
        await expect(adapter.delete('')).rejects.toBeInstanceOf(SystemException);
        expect(redis.del).not.toHaveBeenCalled();
    });
});
