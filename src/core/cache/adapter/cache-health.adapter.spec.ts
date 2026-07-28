/**
 * @file cache-health.adapter.spec.ts
 * @description Unit tests for the Redis cache health adapter.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheHealthAdapter } from 'src/core/cache/adapter/cache-health.adapter';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheHealthAdapter', () => {
    const mockCacheRedis = {
        ping: vi.fn(),
    };

    let adapter: CacheHealthAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CacheHealthAdapter,
                {
                    provide: TOKEN_CACHE_CONNECTION,
                    useValue: mockCacheRedis,
                },
            ],
        }).compile();

        adapter = module.get<CacheHealthAdapter>(CacheHealthAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('ping', () => {
        it('should call ping on the cache Redis client successfully', async () => {
            mockCacheRedis.ping.mockResolvedValueOnce('PONG');

            await expect(adapter.ping()).resolves.toBeUndefined();
            expect(mockCacheRedis.ping).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis ping rejects', async () => {
            mockCacheRedis.ping.mockRejectedValueOnce(new Error());

            await expect(adapter.ping()).rejects.toThrow(Error);
            expect(mockCacheRedis.ping).toHaveBeenCalledTimes(1);
        });
    });
});
