import { Test, TestingModule } from '@nestjs/testing';
import { GetHealthStatusQueryHandler } from 'src/module/health/application/query/get-health-status/handler';
import type { IGetHealthStatusPort } from 'src/module/health/application/query/get-health-status/port';
import { TOKEN_GET_HEALTH_STATUS_PORT } from 'src/module/health/application/query/get-health-status/port';
import type { GetHealthStatusResult } from 'src/module/health/application/query/get-health-status/query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GetHealthStatusQueryHandler', () => {
    let handler: GetHealthStatusQueryHandler;
    let healthCheckPort: IGetHealthStatusPort;

    beforeEach(async () => {
        healthCheckPort = {
            getStatus: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetHealthStatusQueryHandler,
                {
                    provide: TOKEN_GET_HEALTH_STATUS_PORT,
                    useValue: healthCheckPort,
                },
            ],
        }).compile();

        handler = module.get<GetHealthStatusQueryHandler>(GetHealthStatusQueryHandler);
    });

    it('should be defined', () => {
        expect(handler).toBeDefined();
    });

    it('should return HealthyReadModel when port returns ok', async () => {
        const mockResult: GetHealthStatusResult = {
            status: 'ok',
            info: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                database: { status: 'up' },
                cache: { status: 'up' },
            },
            error: {},
            details: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                database: { status: 'up' },
                cache: { status: 'up' },
            },
        };
        const checkSpy = vi.spyOn(healthCheckPort, 'getStatus').mockResolvedValue(mockResult);

        const result = await handler.execute();

        expect(result).toBeDefined();
        expect(result).toEqual(mockResult);
        expect(checkSpy).toHaveBeenCalledOnce();
    });

    it('should return UnhealthyReadModel when port returns error', async () => {
        const mockResult: GetHealthStatusResult = {
            status: 'error',
            info: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                cache: { status: 'up' },
            },
            error: {
                database: { status: 'down', message: 'Connection timeout' },
            },
            details: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                database: { status: 'down', message: 'Connection timeout' },
                cache: { status: 'up' },
            },
        };
        const checkSpy = vi.spyOn(healthCheckPort, 'getStatus').mockResolvedValue(mockResult);

        const result = await handler.execute();

        expect(result).toBeDefined();
        expect(result).toEqual(mockResult);
        expect(checkSpy).toHaveBeenCalledOnce();
    });
});
