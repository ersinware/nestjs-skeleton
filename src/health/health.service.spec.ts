import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, HealthIndicatorService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { TOKEN_DATABASE_HEALTH_INDICATOR } from 'src/database/constant/database.constant';
import { TOKEN_CACHE_HEALTH_INDICATOR } from 'src/cache/constant/cache.constant';

describe('HealthService', () => {
    const mockHealthCheckService = {
            check: vi.fn(async (indicators: (() => unknown)[]) => {
                return Promise.all(indicators.map((indicator) => indicator()));
            }),
        },
        mockMemoryHealthIndicator = {
            checkHeap: vi.fn(),
            checkRSS: vi.fn(),
        },
        mockHealthIndicatorService = {
            check: vi.fn((key: string) => ({
                up: () => ({ [key]: { status: 'up' } }),
                down: (info: Record<string, unknown>) => ({ [key]: { status: 'down', ...info } }),
            })),
        },
        mockConfigService = {
            getOrThrow: vi.fn(),
        },
        mockDatabaseIndicator = {
            ping: vi.fn(),
        },
        mockCacheIndicator = {
            ping: vi.fn(),
        };

    let service: HealthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HealthService,
                { provide: HealthCheckService, useValue: mockHealthCheckService },
                { provide: MemoryHealthIndicator, useValue: mockMemoryHealthIndicator },
                { provide: HealthIndicatorService, useValue: mockHealthIndicatorService },
                { provide: ConfigService, useValue: mockConfigService },
                { provide: TOKEN_DATABASE_HEALTH_INDICATOR, useValue: mockDatabaseIndicator },
                { provide: TOKEN_CACHE_HEALTH_INDICATOR, useValue: mockCacheIndicator },
            ],
        }).compile();

        service = module.get<HealthService>(HealthService);
        mockConfigService.getOrThrow.mockReturnValue(100);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should run all checks and return up statuses when dependencies are healthy', async () => {
        mockMemoryHealthIndicator.checkHeap.mockResolvedValueOnce({ memory_heap: { status: 'up' } });
        mockMemoryHealthIndicator.checkRSS.mockResolvedValueOnce({ memory_rss: { status: 'up' } });
        mockDatabaseIndicator.ping.mockResolvedValueOnce(undefined);
        mockCacheIndicator.ping.mockResolvedValueOnce(undefined);

        await expect(service.check()).resolves.toEqual([
            { memory_heap: { status: 'up' } },
            { memory_rss: { status: 'up' } },
            { database: { status: 'up' } },
            { cache: { status: 'up' } },
        ]);

        expect(mockMemoryHealthIndicator.checkHeap).toHaveBeenCalled();
        expect(mockMemoryHealthIndicator.checkRSS).toHaveBeenCalled();
        expect(mockDatabaseIndicator.ping).toHaveBeenCalled();
        expect(mockCacheIndicator.ping).toHaveBeenCalled();
    });

    it('should return down status when database and redis checks fail', async () => {
        mockMemoryHealthIndicator.checkHeap.mockResolvedValueOnce({ memory_heap: { status: 'up' } });
        mockMemoryHealthIndicator.checkRSS.mockResolvedValueOnce({ memory_rss: { status: 'up' } });
        mockDatabaseIndicator.ping.mockRejectedValueOnce(new Error());
        mockCacheIndicator.ping.mockRejectedValueOnce(new Error());

        await expect(service.check()).resolves.toEqual([
            { memory_heap: { status: 'up' } },
            { memory_rss: { status: 'up' } },
            { database: { status: 'down', message: expect.any(String) as string } },
            { cache: { status: 'down', message: expect.any(String) as string } },
        ]);

        expect(mockMemoryHealthIndicator.checkHeap).toHaveBeenCalled();
        expect(mockMemoryHealthIndicator.checkRSS).toHaveBeenCalled();
        expect(mockDatabaseIndicator.ping).toHaveBeenCalled();
        expect(mockCacheIndicator.ping).toHaveBeenCalled();
    });

    it('should return down status when all checks fail', async () => {
        mockMemoryHealthIndicator.checkHeap.mockResolvedValueOnce({
            memory_heap: { status: 'down', message: 'Heap limit exceeded.' },
        });
        mockMemoryHealthIndicator.checkRSS.mockResolvedValueOnce({
            memory_rss: { status: 'down', message: 'RSS limit exceeded.' },
        });
        mockDatabaseIndicator.ping.mockRejectedValueOnce(new Error());
        mockCacheIndicator.ping.mockRejectedValueOnce(new Error());

        await expect(service.check()).resolves.toEqual([
            { memory_heap: { status: 'down', message: expect.any(String) as string } },
            { memory_rss: { status: 'down', message: expect.any(String) as string } },
            { database: { status: 'down', message: expect.any(String) as string } },
            { cache: { status: 'down', message: expect.any(String) as string } },
        ]);

        expect(mockMemoryHealthIndicator.checkHeap).toHaveBeenCalled();
        expect(mockMemoryHealthIndicator.checkRSS).toHaveBeenCalled();
        expect(mockDatabaseIndicator.ping).toHaveBeenCalled();
        expect(mockCacheIndicator.ping).toHaveBeenCalled();
    });
});
