import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_CACHE_CLIENT, TOKEN_CACHE_STATE_CLIENT } from '../constant/cache.constant';
import { RedisHealthIndicator } from './redis-health.indicator';

describe('RedisHealthIndicator', () => {
    const mockCacheRedis = {
            ping: vi.fn(),
        },
        mockStateRedis = {
            ping: vi.fn(),
        };

    let service: RedisHealthIndicator;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisHealthIndicator,
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

        service = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('ping', () => {
        it('should call ping on both Redis clients successfully', async () => {
            mockCacheRedis.ping.mockResolvedValueOnce('PONG');
            mockStateRedis.ping.mockResolvedValueOnce('PONG');

            await expect(service.ping()).resolves.toBeUndefined();
            expect(mockCacheRedis.ping).toHaveBeenCalledTimes(1);
            expect(mockStateRedis.ping).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis Cache ping rejects', async () => {
            mockCacheRedis.ping.mockRejectedValueOnce(new Error());
            mockStateRedis.ping.mockResolvedValueOnce('PONG');

            await expect(service.ping()).rejects.toThrow(Error);
            expect(mockCacheRedis.ping).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis State ping rejects', async () => {
            mockCacheRedis.ping.mockResolvedValueOnce('PONG');
            mockStateRedis.ping.mockRejectedValueOnce(new Error());

            await expect(service.ping()).rejects.toThrow(Error);
            expect(mockStateRedis.ping).toHaveBeenCalledTimes(1);
        });
    });
});
