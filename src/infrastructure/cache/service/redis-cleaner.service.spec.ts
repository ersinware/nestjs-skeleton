/**
 * @file redis-cleaner.service.spec.ts
 * @description Unit tests for the Redis cache cleaner service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from 'src/common/port/cache/cache.constant';
import { RedisCleanerService } from './redis-cleaner.service';

describe('RedisCleanerService', () => {
    const mockCacheRedis = {
            flushall: vi.fn(),
        },
        mockStateRedis = {
            flushall: vi.fn(),
        };

    let service: RedisCleanerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisCleanerService,
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

        service = module.get<RedisCleanerService>(RedisCleanerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('cleanup', () => {
        it('should call flushall on both Redis clients successfully', async () => {
            mockCacheRedis.flushall.mockResolvedValueOnce('OK');
            mockStateRedis.flushall.mockResolvedValueOnce('OK');

            await expect(service.cleanup()).resolves.toBeUndefined();
            expect(mockCacheRedis.flushall).toHaveBeenCalledTimes(1);
            expect(mockStateRedis.flushall).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis Cache flushall rejects', async () => {
            mockCacheRedis.flushall.mockRejectedValueOnce(new Error());
            mockStateRedis.flushall.mockResolvedValueOnce('OK');

            await expect(service.cleanup()).rejects.toThrow(Error);
            expect(mockCacheRedis.flushall).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis State flushall rejects', async () => {
            mockCacheRedis.flushall.mockResolvedValueOnce('OK');
            mockStateRedis.flushall.mockRejectedValueOnce(new Error());

            await expect(service.cleanup()).rejects.toThrow(Error);
            expect(mockStateRedis.flushall).toHaveBeenCalledTimes(1);
        });
    });
});
