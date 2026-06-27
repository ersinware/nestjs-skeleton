/**
 * @file redis-state.service.spec.ts
 * @description Unit tests for the Redis state service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/common/port/cache/cache.constant';
import { RedisStateService } from './redis-state.service';

describe('RedisStateService', () => {
    const mockRedis = {
            set: vi.fn(),
            get: vi.fn(),
            del: vi.fn(),
            scan: vi.fn(),
            exists: vi.fn(),
        },
        userId = 'user123',
        jti = 'jti456';

    let service: RedisStateService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RedisStateService,
                {
                    provide: TOKEN_CACHE_STATE_CLIENT,
                    useValue: mockRedis,
                },
            ],
        }).compile();

        service = module.get<RedisStateService>(RedisStateService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('saveSession', () => {
        it('should call set with the correct parameters and key pattern', async () => {
            const ttl = 3600;

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(service.saveSession(AuthUserRole.USER, userId, jti, ttl)).resolves.toBeUndefined();

            expect(mockRedis.set).toHaveBeenCalledWith(`session:${AuthUserRole.USER}:${userId}:${jti}`, '1', 'EX', ttl);
        });
    });

    describe('getSession', () => {
        it('should call get and return the value', async () => {
            mockRedis.get.mockResolvedValueOnce('1');

            await expect(service.getSession(AuthUserRole.USER, userId, jti)).resolves.toBe('1');

            expect(mockRedis.get).toHaveBeenCalledWith(`session:${AuthUserRole.USER}:${userId}:${jti}`);
        });

        it('should return null when get resolves to null', async () => {
            mockRedis.get.mockResolvedValueOnce(null);

            await expect(service.getSession(AuthUserRole.USER, userId, jti)).resolves.toBeNull();

            expect(mockRedis.get).toHaveBeenCalledWith(`session:${AuthUserRole.USER}:${userId}:${jti}`);
        });
    });

    describe('deleteSession', () => {
        it('should call del with the formatted key', async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            await expect(service.deleteSession(AuthUserRole.USER, userId, jti)).resolves.toBeUndefined();

            expect(mockRedis.del).toHaveBeenCalledWith(`session:${AuthUserRole.USER}:${userId}:${jti}`);
        });
    });

    describe('deleteAllSessions', () => {
        it('should scan and delete matching keys in chronological order', async () => {
            mockRedis.scan.mockResolvedValueOnce(['0', [`session:${AuthUserRole.USER}:${userId}:key1`]]);
            mockRedis.del.mockResolvedValueOnce(1);

            await expect(service.deleteAllSessions(AuthUserRole.USER, userId)).resolves.toBeUndefined();

            expect(mockRedis.scan).toHaveBeenCalledWith(
                '0',
                'MATCH',
                `session:${AuthUserRole.USER}:${userId}:*`,
                'COUNT',
                100,
            );
            expect(mockRedis.del).toHaveBeenCalledWith(`session:${AuthUserRole.USER}:${userId}:key1`);
        });

        it('should loop scan multiple times if next cursor is not 0', async () => {
            mockRedis.scan
                .mockResolvedValueOnce(['123', [`session:${AuthUserRole.USER}:${userId}:key1`]])
                .mockResolvedValueOnce(['0', [`session:${AuthUserRole.USER}:${userId}:key2`]]);
            mockRedis.del.mockResolvedValue(1);

            await expect(service.deleteAllSessions(AuthUserRole.USER, userId)).resolves.toBeUndefined();

            // Chronological verification
            expect(mockRedis.scan).toHaveBeenNthCalledWith(
                1,
                '0',
                'MATCH',
                `session:${AuthUserRole.USER}:${userId}:*`,
                'COUNT',
                100,
            );
            expect(mockRedis.del).toHaveBeenNthCalledWith(1, `session:${AuthUserRole.USER}:${userId}:key1`);
            expect(mockRedis.scan).toHaveBeenNthCalledWith(
                2,
                '123',
                'MATCH',
                `session:${AuthUserRole.USER}:${userId}:*`,
                'COUNT',
                100,
            );
            expect(mockRedis.del).toHaveBeenNthCalledWith(2, `session:${AuthUserRole.USER}:${userId}:key2`);
        });

        it('should scan but not call del if no matching keys are found', async () => {
            mockRedis.scan.mockResolvedValueOnce(['0', []]);

            await expect(service.deleteAllSessions(AuthUserRole.USER, userId)).resolves.toBeUndefined();

            expect(mockRedis.scan).toHaveBeenCalledWith(
                '0',
                'MATCH',
                `session:${AuthUserRole.USER}:${userId}:*`,
                'COUNT',
                100,
            );
            expect(mockRedis.del).not.toHaveBeenCalled();
        });
    });

    describe('saveBan', () => {
        it('should call set with the banned key and correct TTL', async () => {
            const ttl = 900;

            mockRedis.set.mockResolvedValueOnce('OK');

            await expect(service.saveBan(AuthUserRole.USER, userId, ttl)).resolves.toBeUndefined();

            expect(mockRedis.set).toHaveBeenCalledWith(`banned:${AuthUserRole.USER}:${userId}`, '1', 'EX', ttl);
        });
    });

    describe('deleteBan', () => {
        it('should call del with the banned key', async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            await expect(service.deleteBan(AuthUserRole.USER, userId)).resolves.toBeUndefined();

            expect(mockRedis.del).toHaveBeenCalledWith(`banned:${AuthUserRole.USER}:${userId}`);
        });
    });

    describe('isBanned', () => {
        it('should return true if key exists', async () => {
            mockRedis.exists.mockResolvedValueOnce(1);

            await expect(service.isBanned(AuthUserRole.USER, userId)).resolves.toBe(true);

            expect(mockRedis.exists).toHaveBeenCalledWith(`banned:${AuthUserRole.USER}:${userId}`);
        });

        it('should return false if key does not exist', async () => {
            mockRedis.exists.mockResolvedValueOnce(0);

            await expect(service.isBanned(AuthUserRole.USER, userId)).resolves.toBe(false);

            expect(mockRedis.exists).toHaveBeenCalledWith(`banned:${AuthUserRole.USER}:${userId}`);
        });
    });
});
