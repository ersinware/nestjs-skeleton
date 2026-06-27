/**
 * @file session.service.spec.ts
 * @description Unit tests for the user session management service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from './session.service';
import { TOKEN_CACHE_STATE_SERVICE } from 'src/common/port/cache/cache.constant';
import type { ICacheStateService } from 'src/common/port/cache/cache-state-service.interface';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { ENV } from 'src/common/config/constant/env.constant';

describe('SessionService', () => {
    const mockCacheStateService = {
            saveSession: vi.fn(),
            getSession: vi.fn(),
            deleteSession: vi.fn(),
            deleteAllSessions: vi.fn(),
            saveBan: vi.fn(),
            deleteBan: vi.fn(),
            isBanned: vi.fn(),
        } satisfies ICacheStateService,
        mockConfigService = {
            getOrThrow: vi.fn(),
        };

    let service: SessionService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SessionService,
                { provide: TOKEN_CACHE_STATE_SERVICE, useValue: mockCacheStateService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get(SessionService);

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
        expect(service).toBeDefined();
    });

    describe('openSession', () => {
        it('should open a session and set it in cache with the correct TTL in seconds', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                jti = 'some-jti',
                ttlSeconds = 604800; // 7 days in seconds

            await expect(service.openSession(role, id, jti)).resolves.toBeUndefined();

            expect(mockCacheStateService.saveSession).toHaveBeenCalledWith(role, id, jti, ttlSeconds);
        });
    });

    describe('getSession', () => {
        it('should retrieve the session from cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                jti = 'some-jti';

            vi.mocked(mockCacheStateService.getSession).mockResolvedValueOnce('1');

            await expect(service.getSession(role, id, jti)).resolves.toBe('1');
            expect(mockCacheStateService.getSession).toHaveBeenCalledWith(role, id, jti);
        });
    });

    describe('closeSession', () => {
        it('should delete the session from cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                jti = 'some-jti';

            await expect(service.closeSession(role, id, jti)).resolves.toBeUndefined();
            expect(mockCacheStateService.deleteSession).toHaveBeenCalledWith(role, id, jti);
        });
    });

    describe('closeAllSessions', () => {
        it('should delete all session keys with a wildcard pattern from cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id';

            await expect(service.closeAllSessions(role, id)).resolves.toBeUndefined();
            expect(mockCacheStateService.deleteAllSessions).toHaveBeenCalledWith(role, id);
        });
    });

    describe('ban', () => {
        it('should blacklist access tokens in cache with the correct duration', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                ttlSeconds = 900; // 15m in seconds

            await expect(service.ban(role, id)).resolves.toBeUndefined();

            expect(mockCacheStateService.saveBan).toHaveBeenCalledWith(role, id, ttlSeconds);
        });
    });

    describe('unban', () => {
        it('should remove the access token blacklist in cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id';

            await expect(service.unban(role, id)).resolves.toBeUndefined();

            expect(mockCacheStateService.deleteBan).toHaveBeenCalledWith(role, id);
        });
    });

    describe('parseTtlToSeconds', () => {
        it('should parse TTL in seconds ("s") format correctly', () => {
            expect(service.parseTtlToSeconds('30s')).toBe(30);
        });

        it('should parse TTL in minutes ("m") format correctly', () => {
            expect(service.parseTtlToSeconds('15m')).toBe(900);
        });

        it('should parse TTL in hours ("h") format correctly', () => {
            expect(service.parseTtlToSeconds('2h')).toBe(7200);
        });

        it('should parse TTL in days ("d") format correctly', () => {
            expect(service.parseTtlToSeconds('7d')).toBe(604800);
        });

        it('should throw an Error if the TTL configuration has an invalid format', () => {
            expect(() => service.parseTtlToSeconds('invalid')).toThrow(Error);
        });
    });
});
