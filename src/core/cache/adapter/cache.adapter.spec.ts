/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file redis.service.spec.ts
 * @description Unit tests for the Redis cache service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheAdapter } from 'src/core/cache/adapter/cache.adapter';
import { TOKEN_CACHE_CLIENT } from 'src/core/cache/cache-client.token';
import { LogPayload, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheAdapter', () => {
    const mockRedis = {
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
            scan: vi.fn(),
            exists: vi.fn(),
        },
        mockLoggerPort = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        } as unknown as ILoggerPort,
        mockExceptionTrackerPort = {
            captureException: vi.fn(),
        } as unknown as IExceptionTrackerPort;

    let adapter: CacheAdapter;

    function createLogPayload(method: string, error: Error) {
        return new LogPayload({ class: CacheAdapter.name, method, error });
    }

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CacheAdapter,
                {
                    provide: TOKEN_CACHE_CLIENT,
                    useValue: mockRedis,
                },
                {
                    provide: TOKEN_LOGGER_PORT,
                    useValue: mockLoggerPort,
                },
                {
                    provide: TOKEN_EXCEPTION_TRACKER_PORT,
                    useValue: mockExceptionTrackerPort,
                },
            ],
        }).compile();

        adapter = module.get<CacheAdapter>(CacheAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('get', () => {
        it('should return value from Redis when key exists and is a plain string', async () => {
            const cachedValue = 'cached_value',
                key = 'test_key';

            mockRedis.get.mockResolvedValueOnce(cachedValue);

            expect(await adapter.get(key)).toBe(cachedValue);
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should return parsed object from Redis when key exists and is a JSON string', async () => {
            const cachedObj = { id: 1, name: 'Test' },
                key = 'test_key';

            mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedObj));

            expect(await adapter.get(key)).toEqual(cachedObj);
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should return null when key does not exist', async () => {
            const key = 'non_existent_key';

            mockRedis.get.mockResolvedValueOnce(null);

            expect(await adapter.get(key)).toBeNull();
            expect(mockRedis.get).toHaveBeenCalledWith(key);
        });

        it('should log error and return null when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error();

            mockRedis.get.mockRejectedValueOnce(error);

            expect(await adapter.get(key)).toBeNull();

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createLogPayload(adapter.get.name, error));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(error);
        });

        it('should throw an error if key is empty', async () => {
            await expect(adapter.get('')).rejects.toThrow(Error);
            expect(mockRedis.get).not.toHaveBeenCalled();
        });
    });

    describe('set', () => {
        it('should set key value without TTL when ttlSeconds is not provided', async () => {
            const key = 'test_key',
                value = 'test_value';

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(adapter.set(key, value)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, value);
            expect(mockRedis.set).not.toHaveBeenCalledWith(key, value, 'EX', expect.any(Number));
        });

        it('should set key value with TTL when ttlSeconds is provided', async () => {
            const key = 'test_key',
                value = 'test_value',
                ttl = 3600;

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(adapter.set(key, value, ttl)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, value, 'EX', ttl);
        });

        it('should set key value with jittered TTL when useJitter is enabled', async () => {
            const key = 'test_key',
                value = 'test_value',
                ttl = 3600;

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(adapter.set(key, value, ttl, { useJitter: true })).resolves.toBeUndefined();

            expect(mockRedis.set).toHaveBeenCalledWith(key, value, 'EX', expect.any(Number));

            const lastCallArgs = mockRedis.set.mock.calls[mockRedis.set.mock.calls.length - 1];
            expect(lastCallArgs).toBeDefined();

            const actualTtl = lastCallArgs![3] as number;
            expect(actualTtl).toBeGreaterThanOrEqual(ttl);
            expect(actualTtl).toBeLessThan(ttl + 360);
        });

        it('should serialize object to JSON without modifying it', async () => {
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
                expectedSerialized = JSON.stringify(value);

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(adapter.set(key, value)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, expectedSerialized);
        });

        it('should preserve JSON string exactly as given without parsing', async () => {
            const key = 'test_key',
                sensitiveObj = {
                    id: '123',
                    password: 'secretPassword123',
                },
                value = JSON.stringify(sensitiveObj),
                expectedSerialized = value;

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(adapter.set(key, value)).resolves.toBeUndefined();
            expect(mockRedis.set).toHaveBeenCalledWith(key, expectedSerialized);
        });

        it('should log error when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key',
                value = 'test_value';
            const error = new Error();

            mockRedis.set.mockRejectedValueOnce(error);

            await expect(adapter.set(key, value)).resolves.toBeUndefined();

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createLogPayload(adapter.set.name, error));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(error);
        });

        it('should throw an error if key is empty', async () => {
            await expect(adapter.set('', 'test_value')).rejects.toThrow(Error);
            expect(mockRedis.set).not.toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should call del on Redis with the specified key', async () => {
            const key = 'test_key';

            mockRedis.del.mockResolvedValueOnce(1);

            await expect(adapter.delete(key)).resolves.toBeUndefined();
            expect(mockRedis.del).toHaveBeenCalledWith(key);
        });

        it('should log error when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error();

            mockRedis.del.mockRejectedValueOnce(error);

            await expect(adapter.delete(key)).resolves.toBeUndefined();

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createLogPayload(adapter.delete.name, error));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(error);
        });

        it('should throw an error if key is empty', async () => {
            await expect(adapter.delete('')).rejects.toThrow(Error);
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

            await expect(adapter.deletePattern(pattern)).resolves.toBeUndefined();
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

            await expect(adapter.deletePattern(pattern)).resolves.toBeUndefined();
            expect(mockRedis.scan).toHaveBeenNthCalledWith(1, cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.scan).toHaveBeenNthCalledWith(2, nextCursor, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).toHaveBeenNthCalledWith(1, key1);
            expect(mockRedis.del).toHaveBeenNthCalledWith(2, key2);
        });

        it('should not call del when no keys are returned by scan', async () => {
            const pattern = 'prefix:*';

            mockRedis.scan.mockResolvedValueOnce([cursorStart, []]);

            await expect(adapter.deletePattern(pattern)).resolves.toBeUndefined();
            expect(mockRedis.scan).toHaveBeenCalledWith(cursorStart, 'MATCH', pattern, 'COUNT', 100);
            expect(mockRedis.del).not.toHaveBeenCalled();
        });

        it('should log error when Redis client throws an error (fail-open)', async () => {
            const pattern = 'prefix:*';
            const error = new Error('Redis scan failed');

            mockRedis.scan.mockRejectedValueOnce(error);

            await expect(adapter.deletePattern(pattern)).resolves.toBeUndefined();

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createLogPayload(adapter.deletePattern.name, error));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(error);
        });

        it('should throw an error if pattern is empty', async () => {
            await expect(adapter.deletePattern('')).rejects.toThrow(Error);
            expect(mockRedis.scan).not.toHaveBeenCalled();
        });
    });

    describe('exists', () => {
        it('should return true when exists call returns greater than 0', async () => {
            const key = 'test_key';

            mockRedis.exists.mockResolvedValueOnce(1);

            expect(await adapter.exists(key)).toBe(true);
            expect(mockRedis.exists).toHaveBeenCalledWith(key);
        });

        it('should return false when exists call returns 0', async () => {
            const key = 'non_existent_key';

            mockRedis.exists.mockResolvedValueOnce(0);

            expect(await adapter.exists(key)).toBe(false);
            expect(mockRedis.exists).toHaveBeenCalledWith(key);
        });

        it('should log error and return false when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error('Redis exists failed');

            mockRedis.exists.mockRejectedValueOnce(error);

            expect(await adapter.exists(key)).toBe(false);

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createLogPayload(adapter.exists.name, error));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(error);
        });

        it('should throw an error if key is empty', async () => {
            await expect(adapter.exists('')).rejects.toThrow(Error);
            expect(mockRedis.exists).not.toHaveBeenCalled();
        });
    });
});
