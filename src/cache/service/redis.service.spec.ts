import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_CACHE_CLIENT } from '../constant/cache.constant';
import { RedisService } from './redis.service';
import { LogPayload } from 'src/common/logger/log-payload';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

describe('RedisService', () => {
    const mockRedis = {
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
            scan: vi.fn(),
            exists: vi.fn(),
        },
        mockLogger = {
            error: vi.fn(),
        };

    let service: RedisService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisService,
                {
                    provide: TOKEN_CACHE_CLIENT,
                    useValue: mockRedis,
                },
                {
                    provide: Logger,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        service = module.get<RedisService>(RedisService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('get', () => {
        it('should return value from Redis when key exists and is a plain string', async () => {
            const cachedValue = 'cached_value',
                key = 'test_key';

            mockRedis.get.mockResolvedValueOnce(cachedValue);

            expect(await service.get(key)).toBe(cachedValue);
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should return parsed object from Redis when key exists and is a JSON string', async () => {
            const cachedObj = { id: 1, name: 'Test' },
                key = 'test_key';

            mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedObj));

            expect(await service.get(key)).toEqual(cachedObj);
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should return null when key does not exist', async () => {
            const key = 'non_existent_key';

            mockRedis.get.mockResolvedValueOnce(null);

            expect(await service.get(key)).toBeNull();
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should log error and return null when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error();

            mockRedis.get.mockRejectedValueOnce(error);

            expect(await service.get(key)).toBeNull();

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: RedisService.name,
                    method: service.get.name,
                    error,
                }),
            );
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

            await expect(service.set(key, value)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, value);
            expect(mockRedis.set).not.toHaveBeenCalledWith(key, value, 'EX', expect.any(Number));
        });

        it('should set key value with TTL when ttlSeconds is provided', async () => {
            const key = 'test_key',
                value = 'test_value',
                ttl = 3600;

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(service.set(key, value, ttl)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, value, 'EX', ttl);
        });

        it('should serialize object to JSON and strip sensitive fields', async () => {
            const key = 'test_key',
                value = {
                    id: '123',
                    name: 'John Doe',
                    password: 'secretPassword123',
                    passwordHash: 'someHashedVal',
                    salt: 'someSalt',
                    secret: 'superSecret',
                    nested: {
                        field: 'value',
                        password: 'nestedSecret',
                    },
                },
                expectedSerialized = JSON.stringify({
                    id: '123',
                    name: 'John Doe',
                    nested: {
                        field: 'value',
                    },
                });

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(service.set(key, value)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, expectedSerialized);
        });

        it('should parse, sanitize, and serialize when input value is a JSON string containing sensitive fields', async () => {
            const key = 'test_key',
                sensitiveObj = {
                    id: '123',
                    password: 'secretPassword123',
                },
                value = JSON.stringify(sensitiveObj),
                expectedSerialized = JSON.stringify({
                    id: '123',
                });

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(service.set(key, value)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, expectedSerialized);
        });

        it('should log error when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key',
                value = 'test_value';
            const error = new Error();

            mockRedis.set.mockRejectedValueOnce(error);

            await expect(service.set(key, value)).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: RedisService.name,
                    method: service.set.name,
                    error,
                }),
            );
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

            await expect(service.delete(key)).resolves.toBeUndefined();
            expect(mockRedis.del).toHaveBeenCalledWith(key);
        });

        it('should log error when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error();

            mockRedis.del.mockRejectedValueOnce(error);

            await expect(service.delete(key)).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: RedisService.name,
                    method: service.delete.name,
                    error,
                }),
            );
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

            await expect(service.deletePattern(pattern)).resolves.toBeUndefined();
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

            await expect(service.deletePattern(pattern)).resolves.toBeUndefined();
            expect(mockRedis.scan).toHaveBeenNthCalledWith(1, cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.scan).toHaveBeenNthCalledWith(2, nextCursor, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).toHaveBeenNthCalledWith(1, key1);
            expect(mockRedis.del).toHaveBeenNthCalledWith(2, key2);
        });

        it('should not call del when no keys are returned by scan', async () => {
            const pattern = 'prefix:*';

            mockRedis.scan.mockResolvedValueOnce([cursorStart, []]);

            await expect(service.deletePattern(pattern)).resolves.toBeUndefined();
            expect(mockRedis.scan).toHaveBeenCalledWith(cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).not.toHaveBeenCalled();
        });

        it('should log error when Redis client throws an error (fail-open)', async () => {
            const pattern = 'prefix:*';
            const error = new Error('Redis scan failed');

            mockRedis.scan.mockRejectedValueOnce(error);

            await expect(service.deletePattern(pattern)).resolves.toBeUndefined();

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: RedisService.name,
                    method: service.deletePattern.name,
                    error,
                }),
            );
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

        it('should log error and return false when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error('Redis exists failed');

            mockRedis.exists.mockRejectedValueOnce(error);

            expect(await service.exists(key)).toBe(false);

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: RedisService.name,
                    method: service.exists.name,
                    error,
                }),
            );
        });

        it('should throw an error if key is empty', async () => {
            await expect(service.exists('')).rejects.toThrow(Error);
            expect(mockRedis.exists).not.toHaveBeenCalled();
        });
    });
});
