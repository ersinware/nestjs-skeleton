import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import { RedisHealthIndicator } from './redis-health.indicator';

describe('RedisHealthIndicator', () => {
    const mockRedis = {
        ping: vi.fn(),
    };

    let service: RedisHealthIndicator;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisHealthIndicator,
                {
                    provide: TOKEN_CACHE_CLIENT,
                    useValue: mockRedis,
                },
            ],
        }).compile();

        service = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('ping', () => {
        it('should call ping on Redis client successfully', async () => {
            mockRedis.ping.mockResolvedValueOnce('PONG');

            await expect(service.ping()).resolves.toBeUndefined();
            expect(mockRedis.ping).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis ping rejects', async () => {
            mockRedis.ping.mockRejectedValueOnce(new Error());

            await expect(service.ping()).rejects.toThrow(Error);
            expect(mockRedis.ping).toHaveBeenCalledTimes(1);
        });
    });
});
