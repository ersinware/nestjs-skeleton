/**
 * @file redis-cleaner.service.spec.ts
 * @description Unit tests for the Redis cache cleaner service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheCleanerAdapter } from 'src/core/cache/adapter/cache-cleaner.adapter';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache/constant/constant';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheCleanerAdapter', () => {
    const mockCacheRedis = {
            flushall: vi.fn(),
        },
        mockStateRedis = {
            flushall: vi.fn(),
        };

    let adapter: CacheCleanerAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CacheCleanerAdapter,
                {
                    provide: TOKEN_CACHE_CLIENT,
                    useValue: mockCacheRedis,
                },
                {
                    provide: TOKEN_CACHE_STATE_CLIENT,
                    useValue: mockStateRedis,
                },
            ],
        }).compile();

        adapter = module.get<CacheCleanerAdapter>(CacheCleanerAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('cleanup', () => {
        it('should call flushall on both Redis clients successfully', async () => {
            mockCacheRedis.flushall.mockResolvedValueOnce('OK');
            mockStateRedis.flushall.mockResolvedValueOnce('OK');

            await expect(adapter.cleanup()).resolves.toBeUndefined();
            expect(mockCacheRedis.flushall).toHaveBeenCalledTimes(1);
            expect(mockStateRedis.flushall).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis Cache flushall rejects', async () => {
            mockCacheRedis.flushall.mockRejectedValueOnce(new Error());
            mockStateRedis.flushall.mockResolvedValueOnce('OK');

            await expect(adapter.cleanup()).rejects.toThrow(Error);
            expect(mockCacheRedis.flushall).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis State flushall rejects', async () => {
            mockCacheRedis.flushall.mockResolvedValueOnce('OK');
            mockStateRedis.flushall.mockRejectedValueOnce(new Error());

            await expect(adapter.cleanup()).rejects.toThrow(Error);
            expect(mockStateRedis.flushall).toHaveBeenCalledTimes(1);
        });
    });
});
