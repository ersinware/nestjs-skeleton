/**
 * @file redis-health.indicator.spec.ts
 * @description Unit tests for the Redis cache health indicator service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheHealthAdapter } from 'src/core/cache/adapter/cache-health.adapter';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache/constant/constant';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheHealthAdapter', () => {
    const mockCacheRedis = {
            ping: vi.fn(),
        },
        mockStateRedis = {
            ping: vi.fn(),
        };

    let adapter: CacheHealthAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CacheHealthAdapter,
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

        adapter = module.get<CacheHealthAdapter>(CacheHealthAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('ping', () => {
        it('should call ping on both Redis clients successfully', async () => {
            mockCacheRedis.ping.mockResolvedValueOnce('PONG');
            mockStateRedis.ping.mockResolvedValueOnce('PONG');

            await expect(adapter.ping()).resolves.toBeUndefined();
            expect(mockCacheRedis.ping).toHaveBeenCalledTimes(1);
            expect(mockStateRedis.ping).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis Cache ping rejects', async () => {
            mockCacheRedis.ping.mockRejectedValueOnce(new Error());
            mockStateRedis.ping.mockResolvedValueOnce('PONG');

            await expect(adapter.ping()).rejects.toThrow(Error);
            expect(mockCacheRedis.ping).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis State ping rejects', async () => {
            mockCacheRedis.ping.mockResolvedValueOnce('PONG');
            mockStateRedis.ping.mockRejectedValueOnce(new Error());

            await expect(adapter.ping()).rejects.toThrow(Error);
            expect(mockStateRedis.ping).toHaveBeenCalledTimes(1);
        });
    });
});
