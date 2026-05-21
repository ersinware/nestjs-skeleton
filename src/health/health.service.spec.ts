import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, HealthIndicatorService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { DRIZZLE_DB } from 'src/database/constant';
import { REDIS_CLIENT } from 'src/redis/constant/redis.constant';

describe('HealthService', () => {
    let service: HealthService;

    const mockHealthCheckService = {
        check: jest.fn((indicators: (() => unknown)[]) => {
            return Promise.all(indicators.map((indicator) => indicator()));
        }),
    };

    const mockMemoryHealthIndicator = {
        checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
        checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
    };

    const mockIndicator = {
        up: jest.fn().mockReturnValue({ status: 'up' }),
        down: jest.fn().mockImplementation((info: Record<string, unknown>) => ({ status: 'down', ...info })),
    };

    const mockHealthIndicatorService = {
        check: jest.fn().mockReturnValue(mockIndicator),
    };

    const mockConfigService = {
        getOrThrow: jest.fn().mockReturnValue(100), // returns 100 for MB limit config checks
    };

    const mockDatabase = {
        execute: jest.fn(),
    };

    const mockRedis = {
        ping: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HealthService,
                { provide: HealthCheckService, useValue: mockHealthCheckService },
                { provide: MemoryHealthIndicator, useValue: mockMemoryHealthIndicator },
                { provide: HealthIndicatorService, useValue: mockHealthIndicatorService },
                { provide: ConfigService, useValue: mockConfigService },
                { provide: DRIZZLE_DB, useValue: mockDatabase },
                { provide: REDIS_CLIENT, useValue: mockRedis },
            ],
        }).compile();

        service = module.get<HealthService>(HealthService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should run all checks and return up statuses when dependencies are healthy', async () => {
        mockDatabase.execute.mockResolvedValueOnce([]);
        mockRedis.ping.mockResolvedValueOnce('PONG');

        const result = await service.check();

        expect(result).toEqual([
            { memory_heap: { status: 'up' } },
            { memory_rss: { status: 'up' } },
            { status: 'up' }, // database
            { status: 'up' }, // redis
        ]);

        expect(mockDatabase.execute).toHaveBeenCalled();
        expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should return down status when database check fails', async () => {
        mockDatabase.execute.mockRejectedValueOnce(new Error('DB connection error'));
        mockRedis.ping.mockResolvedValueOnce('PONG');

        const result = await service.check();

        expect(result).toEqual([
            { memory_heap: { status: 'up' } },
            { memory_rss: { status: 'up' } },
            { status: 'down', message: 'Database connection failed.' },
            { status: 'up' },
        ]);
    });

    it('should return down status when redis check fails', async () => {
        mockDatabase.execute.mockResolvedValueOnce([]);
        mockRedis.ping.mockRejectedValueOnce(new Error('Redis connection error'));

        const result = await service.check();

        expect(result).toEqual([
            { memory_heap: { status: 'up' } },
            { memory_rss: { status: 'up' } },
            { status: 'up' },
            { status: 'down', message: 'Redis connection failed.' },
        ]);
    });
});
