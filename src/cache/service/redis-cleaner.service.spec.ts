import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import { RedisCleaner } from './redis-cleaner.service';

describe('RedisCleaner', () => {
    const mockRedis = {
        flushall: vi.fn(),
    };

    let service: RedisCleaner;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisCleaner,
                {
                    provide: TOKEN_CACHE_CLIENT,
                    useValue: mockRedis,
                },
            ],
        }).compile();

        service = module.get<RedisCleaner>(RedisCleaner);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('cleanup', () => {
        it('should call flushall on Redis client successfully', async () => {
            mockRedis.flushall.mockResolvedValueOnce('OK');

            await expect(service.cleanup()).resolves.toBeUndefined();
            expect(mockRedis.flushall).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if Redis flushall rejects', async () => {
            mockRedis.flushall.mockRejectedValueOnce(new Error());

            await expect(service.cleanup()).rejects.toThrow(Error);
            expect(mockRedis.flushall).toHaveBeenCalledTimes(1);
        });
    });
});
