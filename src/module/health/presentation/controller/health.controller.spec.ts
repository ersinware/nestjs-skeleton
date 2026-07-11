/**
 * @file health.controller.spec.ts
 * @description Unit tests for the HealthController. Verifies that health endpoints correctly invoke the underlying service and handle the returned results or exceptions appropriately.
 */

import { QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { GetHealthStatusQuery } from 'src/module/health/application/query/get-health-status';
import { HealthController } from 'src/module/health/presentation/controller/health.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('HealthController', () => {
    const mockQueryBus = {
        execute: vi.fn(),
    };

    let controller: HealthController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [HealthController],
            providers: [{ provide: QueryBus, useValue: mockQueryBus }],
        }).compile();

        controller = module.get<HealthController>(HealthController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    it('should return the result of QueryBus.execute', async () => {
        mockQueryBus.execute.mockResolvedValueOnce('mocked-result');

        await expect(controller.getStatus()).resolves.toBe('mocked-result');
        expect(mockQueryBus.execute).toHaveBeenCalledTimes(1);
        expect(mockQueryBus.execute).toHaveBeenCalledWith(new GetHealthStatusQuery());
    });

    it('should propagate service exception if query bus throws an error', async () => {
        mockQueryBus.execute.mockRejectedValueOnce(new Error());

        await expect(controller.getStatus()).rejects.toThrow(Error);
        expect(mockQueryBus.execute).toHaveBeenCalledTimes(1);
    });
});
