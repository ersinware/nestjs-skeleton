import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from './session.service';
import { TOKEN_CACHE_SERVICE } from 'src/cache/constant/cache.constant';
import { AuthUserRole } from 'src/common/guard/enum/auth-user-role.enum';
import { ENV } from 'src/common/config/constant/env.constant';

describe('SessionService', () => {
    const mockCacheService = {
            set: vi.fn(),
            get: vi.fn(),
            delete: vi.fn(),
            deletePattern: vi.fn(),
        },
        mockConfigService = {
            getOrThrow: vi.fn(),
        },
        JWT_ACCESS_TTL = '15m',
        JWT_REFRESH_TTL = '7d';

    let service: SessionService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SessionService,
                { provide: TOKEN_CACHE_SERVICE, useValue: mockCacheService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get(SessionService);

        mockConfigService.getOrThrow.mockImplementation((key: string) => {
            switch (key) {
                case ENV.JWT_ACCESS_TTL:
                    return JWT_ACCESS_TTL;
                case ENV.JWT_REFRESH_TTL:
                    return JWT_REFRESH_TTL;
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

            expect(mockCacheService.set).toHaveBeenCalledWith(`session:${role}:${id}:${jti}`, '1', ttlSeconds);
        });
    });

    describe('getSession', () => {
        it('should retrieve the session from cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                jti = 'some-jti';

            mockCacheService.get.mockResolvedValueOnce('1');

            await expect(service.getSession(role, id, jti)).resolves.toBe('1');
            expect(mockCacheService.get).toHaveBeenCalledWith(`session:${role}:${id}:${jti}`);
        });
    });

    describe('closeSession', () => {
        it('should delete the session from cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                jti = 'some-jti';

            await expect(service.closeSession(role, id, jti)).resolves.toBeUndefined();
            expect(mockCacheService.delete).toHaveBeenCalledWith(`session:${role}:${id}:${jti}`);
        });
    });

    describe('closeAllSessions', () => {
        it('should delete all session keys with a wildcard pattern from cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id';

            await expect(service.closeAllSessions(role, id)).resolves.toBeUndefined();
            expect(mockCacheService.deletePattern).toHaveBeenCalledWith(`session:${role}:${id}:*`);
        });
    });

    describe('ban', () => {
        it('should blacklist access tokens in cache with the correct duration', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id',
                ttlSeconds = 900; // 15m in seconds

            await expect(service.ban(role, id)).resolves.toBeUndefined();

            expect(mockCacheService.set).toHaveBeenCalledWith(`banned:${role}:${id}`, '1', ttlSeconds);
        });
    });

    describe('unban', () => {
        it('should remove the access token blacklist in cache', async () => {
            const role = AuthUserRole.USER,
                id = 'user-id';

            await expect(service.unban(role, id)).resolves.toBeUndefined();

            expect(mockCacheService.delete).toHaveBeenCalledWith(`banned:${role}:${id}`);
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
