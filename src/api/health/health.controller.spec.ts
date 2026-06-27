/**
 * @file health.controller.spec.ts
 * @description Unit tests for the HealthController. Verifies that health endpoints correctly invoke the underlying service and handle the returned results or exceptions appropriately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
    const mockHealthService = {
        check: vi.fn(),
    };

    let controller: HealthController;

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

    it('should return the result of healthService.check', async () => {
        mockHealthService.check.mockResolvedValueOnce('mocked-result');

        await expect(controller.check()).resolves.toBe('mocked-result');
        expect(mockHealthService.check).toHaveBeenCalledTimes(1);
    });

    it('should propagate service exception if health service throws an error', async () => {
        mockHealthService.check.mockRejectedValueOnce(new Error());

        await expect(controller.check()).rejects.toThrow(Error);
        expect(mockHealthService.check).toHaveBeenCalledTimes(1);
    });
});
