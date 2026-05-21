import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
    let controller: HealthController;

    const mockHealthService = {
        check: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [HealthController],
            providers: [{ provide: HealthService, useValue: mockHealthService }],
        }).compile();

        controller = module.get<HealthController>(HealthController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    it('should return health check result', async () => {
        const mockResult = {
            status: 'ok',
            info: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                database: { status: 'up' },
                redis: { status: 'up' },
            },
            error: {},
            details: {
                memory_heap: { status: 'up' },
                memory_rss: { status: 'up' },
                database: { status: 'up' },
                redis: { status: 'up' },
            },
        };

        mockHealthService.check.mockResolvedValueOnce(mockResult);

        const result = await controller.check();

        expect(result).toEqual(mockResult);
        expect(mockHealthService.check).toHaveBeenCalled();
    });
});
