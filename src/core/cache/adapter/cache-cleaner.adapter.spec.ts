/**
 * @file cache-cleaner.adapter.spec.ts
 * @description Unit tests for the Redis cache cleaner adapter.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheCleanerAdapter } from 'src/core/cache/adapter/cache-cleaner.adapter';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheCleanerAdapter', () => {
    const mockCacheRedis = {
        flushall: vi.fn(),
    };

    let adapter: CacheCleanerAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CacheCleanerAdapter,
                {
                    provide: TOKEN_CACHE_CONNECTION,
                    useValue: mockCacheRedis,
                },
            ],
        }).compile();

        adapter = module.get<CacheCleanerAdapter>(CacheCleanerAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('cleanup', () => {
        it('should call flushall on the cache Redis client successfully', async () => {
            mockCacheRedis.flushall.mockResolvedValueOnce('OK');

            await expect(adapter.cleanup()).resolves.toBeUndefined();
            expect(mockCacheRedis.flushall).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis flushall rejects', async () => {
            mockCacheRedis.flushall.mockRejectedValueOnce(new Error());

            await expect(adapter.cleanup()).rejects.toThrow(Error);
            expect(mockCacheRedis.flushall).toHaveBeenCalledTimes(1);
        });
    });
});
