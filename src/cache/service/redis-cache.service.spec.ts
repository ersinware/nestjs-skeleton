import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import { RedisCacheService } from './redis-cache.service';

describe('RedisCacheService', () => {
    const mockRedis = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        scan: vi.fn(),
        exists: vi.fn(),
    };

    let service: RedisCacheService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisCacheService,
                {
                    provide: TOKEN_CACHE_CLIENT,
                    useValue: mockRedis,
                },
            ],
        }).compile();

        service = module.get<RedisCacheService>(RedisCacheService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('get', () => {
        it('should return value from Redis when key exists', async () => {
            const cachedValue = 'cached_value',
                key = 'test_key';

            mockRedis.get.mockResolvedValueOnce(cachedValue);

            expect(await service.get(key)).toBe(cachedValue);
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should return null when key does not exist', async () => {
            const key = 'non_existent_key';

            mockRedis.get.mockResolvedValueOnce(null);

            expect(await service.get(key)).toBeNull();
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should throw an error if key is empty', async () => {
            await expect(service.get('')).rejects.toThrow(Error);
            expect(mockRedis.get).not.toHaveBeenCalled();
        });
    });

    describe('set', () => {
        it('should set key value without TTL when ttlSeconds is not provided', async () => {
            const key = 'test_key',
                value = 'test_value';

            mockRedis.set.mockResolvedValueOnce('OK');

            await service.set(key, value);

            expect(mockRedis.set).toHaveBeenCalledWith(key, value);
            expect(mockRedis.set).not.toHaveBeenCalledWith(key, value, 'EX', expect.any(Number));
        });

        it('should set key value with TTL when ttlSeconds is provided', async () => {
            const key = 'test_key',
                value = 'test_value',
                ttl = 3600;

            mockRedis.set.mockResolvedValueOnce('OK');

            await service.set(key, value, ttl);

            expect(mockRedis.set).toHaveBeenCalledWith(key, value, 'EX', ttl);
        });

        it('should throw an error if key is empty', async () => {
            await expect(service.set('', 'test_value')).rejects.toThrow(Error);
            expect(mockRedis.set).not.toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should call del on Redis with the specified key', async () => {
            const key = 'test_key';

            mockRedis.del.mockResolvedValueOnce(1);

            await service.delete(key);

            expect(mockRedis.del).toHaveBeenCalledWith(key);
        });

        it('should throw an error if key is empty', async () => {
            await expect(service.delete('')).rejects.toThrow(Error);
            expect(mockRedis.del).not.toHaveBeenCalled();
        });
    });

    describe('deletePattern', () => {
        const cursorStart = '0';

        it('should scan and delete matching keys in a single page', async () => {
            const pattern = 'prefix:*',
                keys = ['key1', 'key2'];

            mockRedis.scan.mockResolvedValueOnce([cursorStart, keys]);
            mockRedis.del.mockResolvedValueOnce(2);

            await service.deletePattern(pattern);

            expect(mockRedis.scan).toHaveBeenCalledWith(cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).toHaveBeenCalledWith(...keys);
        });

        it('should scan and delete matching keys across multiple pages', async () => {
            const pattern = 'prefix:*',
                key1 = 'key1',
                key2 = 'key2',
                nextCursor = '123';

            mockRedis.scan.mockResolvedValueOnce([nextCursor, [key1]]).mockResolvedValueOnce([cursorStart, [key2]]);
            mockRedis.del.mockResolvedValue(1);

            await service.deletePattern(pattern);

            expect(mockRedis.scan).toHaveBeenNthCalledWith(1, cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.scan).toHaveBeenNthCalledWith(2, nextCursor, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).toHaveBeenNthCalledWith(1, key1);
            expect(mockRedis.del).toHaveBeenNthCalledWith(2, key2);
        });

        it('should not call del when no keys are returned by scan', async () => {
            const pattern = 'prefix:*';

            mockRedis.scan.mockResolvedValueOnce([cursorStart, []]);

            await service.deletePattern(pattern);

            expect(mockRedis.scan).toHaveBeenCalledWith(cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).not.toHaveBeenCalled();
        });

        it('should throw an error if pattern is empty', async () => {
            await expect(service.deletePattern('')).rejects.toThrow(Error);
            expect(mockRedis.scan).not.toHaveBeenCalled();
        });
    });

    describe('exists', () => {
        it('should return true when exists call returns greater than 0', async () => {
            const key = 'test_key';

            mockRedis.exists.mockResolvedValueOnce(1);

            expect(await service.exists(key)).toBe(true);
            expect(mockRedis.exists).toHaveBeenCalledWith(key);
        });

        it('should return false when exists call returns 0', async () => {
            const key = 'non_existent_key';

            mockRedis.exists.mockResolvedValueOnce(0);

            expect(await service.exists(key)).toBe(false);
            expect(mockRedis.exists).toHaveBeenCalledWith(key);
        });

        it('should throw an error if key is empty', async () => {
            await expect(service.exists('')).rejects.toThrow(Error);
            expect(mockRedis.exists).not.toHaveBeenCalled();
        });
    });
});
