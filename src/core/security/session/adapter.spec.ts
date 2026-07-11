/**
 * @file session.adapter.spec.ts
 * @description Unit tests for the user session management service.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache/constant/constant';
import { ENV } from 'src/core/config';
import { SessionAdapter } from 'src/core/security/session/adapter';
import { UserRole } from 'src/shared/domain/user';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SessionAdapter', () => {
    const mockRedis = {
            set: vi.fn(),
            get: vi.fn(),
            del: vi.fn(),
            scan: vi.fn(),
            exists: vi.fn(),
        },
        mockConfigService = {
            getOrThrow: vi.fn(),
        };

    let adapter: SessionAdapter;

    beforeEach(async () => {
        vi.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SessionAdapter,
                { provide: TOKEN_CACHE_STATE_CLIENT, useValue: mockRedis },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        adapter = module.get(SessionAdapter);

        mockConfigService.getOrThrow.mockImplementation((key: string) => {
            switch (key) {
                case ENV.JWT_ACCESS_TTL:
                    return '15m';
                case ENV.JWT_REFRESH_TTL:
                    return '7d';
                default:
                    throw new Error(`Unexpected config key: ${key}`);
            }
        });
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('openSession', () => {
        it('should open a session and set it in redis with the correct TTL in seconds', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                jti = 'some-jti',
                ttlSeconds = 604800; // 7 days in seconds

            await expect(adapter.openSession(role, id, jti)).resolves.toBeUndefined();

            expect(mockRedis.set).toHaveBeenCalledWith(`session:${role}:${id}:${jti}`, '1', 'EX', ttlSeconds);
        });
    });

    describe('getSession', () => {
        it('should retrieve the session from redis', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                jti = 'some-jti';

            mockRedis.get.mockResolvedValueOnce('1');

            await expect(adapter.getSession(role, id, jti)).resolves.toBe('1');
            expect(mockRedis.get).toHaveBeenCalledWith(`session:${role}:${id}:${jti}`);
        });
    });

    describe('closeSession', () => {
        it('should delete the session from redis', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                jti = 'some-jti';

            await expect(adapter.closeSession(role, id, jti)).resolves.toBeUndefined();
            expect(mockRedis.del).toHaveBeenCalledWith(`session:${role}:${id}:${jti}`);
        });
    });

    describe('closeAllSessions', () => {
        it('should delete all session keys with a wildcard pattern from redis', async () => {
            const role = UserRole.USER,
                id = 'user-id';

            mockRedis.scan.mockResolvedValueOnce(['0', ['session:USER:user-id:1', 'session:USER:user-id:2']]);

            await expect(adapter.closeAllSessions(role, id)).resolves.toBeUndefined();
            expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', `session:${role}:${id}:*`, 'COUNT', 100);
            expect(mockRedis.del).toHaveBeenCalledWith('session:USER:user-id:1', 'session:USER:user-id:2');
        });
    });

    describe('ban', () => {
        it('should blacklist access tokens in redis with the correct duration', async () => {
            const role = UserRole.USER,
                id = 'user-id',
                ttlSeconds = 900; // 15m in seconds

            await expect(adapter.ban(role, id)).resolves.toBeUndefined();

            expect(mockRedis.set).toHaveBeenCalledWith(`banned:${role}:${id}`, '1', 'EX', ttlSeconds);
        });
    });

    describe('unban', () => {
        it('should remove the access token blacklist in redis', async () => {
            const role = UserRole.USER,
                id = 'user-id';

            await expect(adapter.unban(role, id)).resolves.toBeUndefined();

            expect(mockRedis.del).toHaveBeenCalledWith(`banned:${role}:${id}`);
        });
    });

    describe('isBanned', () => {
        it('should return true if banned key exists', async () => {
            const role = UserRole.USER,
                id = 'user-id';

            mockRedis.exists.mockResolvedValueOnce(1);

            await expect(adapter.isBanned(role, id)).resolves.toBe(true);
            expect(mockRedis.exists).toHaveBeenCalledWith(`banned:${role}:${id}`);
        });

        it('should return false if banned key does not exist', async () => {
            const role = UserRole.USER,
                id = 'user-id';

            mockRedis.exists.mockResolvedValueOnce(0);

            await expect(adapter.isBanned(role, id)).resolves.toBe(false);
            expect(mockRedis.exists).toHaveBeenCalledWith(`banned:${role}:${id}`);
        });
    });

    describe('parseTtlToSeconds', () => {
        it('should parse TTL in seconds ("s") format correctly', () => {
            expect(adapter.parseTtlToSeconds('30s')).toBe(30);
        });

        it('should parse TTL in minutes ("m") format correctly', () => {
            expect(adapter.parseTtlToSeconds('15m')).toBe(900);
        });

        it('should parse TTL in hours ("h") format correctly', () => {
            expect(adapter.parseTtlToSeconds('2h')).toBe(7200);
        });

        it('should parse TTL in days ("d") format correctly', () => {
            expect(adapter.parseTtlToSeconds('7d')).toBe(604800);
        });

        it('should throw an Error if the TTL configuration has an invalid format', () => {
            expect(() => adapter.parseTtlToSeconds('invalid')).toThrow(Error);
        });
    });
});
