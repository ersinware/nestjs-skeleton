/**
 * @file health.controller.spec.ts
 * @description Unit tests for the HealthController. Verifies that health endpoints correctly invoke the underlying service and handle the returned results or exceptions appropriately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { QueryPipeline } from 'src/core/cqrs';
import { GetHealthStatusQuery } from 'src/module/health/application/query/get-health-status/query';
import { HealthController } from 'src/module/health/presentation/controller/health.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('HealthController', () => {
    const mockQueryPipeline = {
        execute: vi.fn(),
    };

    let controller: HealthController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [HealthController],
            providers: [{ provide: QueryPipeline, useValue: mockQueryPipeline }],
        }).compile();

        controller = module.get<HealthController>(HealthController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    it('should return the result of QueryPipeline.execute', async () => {
        mockQueryPipeline.execute.mockResolvedValueOnce('mocked-result');

        await expect(controller.getStatus()).resolves.toBe('mocked-result');
        expect(mockQueryPipeline.execute).toHaveBeenCalledTimes(1);
        expect(mockQueryPipeline.execute).toHaveBeenCalledWith(new GetHealthStatusQuery());
    });

    it('should propagate service exception if query pipeline throws an error', async () => {
        mockQueryPipeline.execute.mockRejectedValueOnce(new Error());

        await expect(controller.getStatus()).rejects.toThrow(Error);
        expect(mockQueryPipeline.execute).toHaveBeenCalledTimes(1);
    });
});
