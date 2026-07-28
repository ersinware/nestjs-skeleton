/**
 * @file cache.adapter.spec.ts
 * @description Unit tests for the Redis cache adapter.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CacheAdapter } from 'src/core/cache/adapter/cache.adapter';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CacheAdapter', () => {
    const mockRedis = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
    };

    let adapter: CacheAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CacheAdapter,
                {
                    provide: TOKEN_CACHE_CONNECTION,
                    useValue: mockRedis,
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

        it('should return null silently when Redis client throws an error (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error();

            mockRedis.get.mockRejectedValueOnce(error);

            expect(await adapter.get(key)).toBeNull();
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

        it('should swallow the error silently when Redis client throws (fail-open)', async () => {
            const key = 'test_key',
                value = 'test_value';
            const error = new Error();

            mockRedis.set.mockRejectedValueOnce(error);

            await expect(adapter.set(key, value)).resolves.toBeUndefined();
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

        it('should swallow the error silently when Redis client throws (fail-open)', async () => {
            const key = 'test_key';
            const error = new Error();

            mockRedis.del.mockRejectedValueOnce(error);

            await expect(adapter.delete(key)).resolves.toBeUndefined();
        });

        it('should throw an error if key is empty', async () => {
            await expect(adapter.delete('')).rejects.toThrow(Error);
            expect(mockRedis.del).not.toHaveBeenCalled();
        });
    });
});
