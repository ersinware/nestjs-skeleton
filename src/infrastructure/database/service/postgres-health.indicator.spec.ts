/**
 * @file postgres-health.indicator.spec.ts
 * @description Unit tests for the PostgreSQL database health indicator service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_DATABASE } from 'src/common/port/database/database.constant';
import { PostgresHealthIndicator } from './postgres-health.indicator';

describe('PostgresHealthIndicator', () => {
    const mockDb = {
        execute: vi.fn(),
    };

    let service: PostgresHealthIndicator;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostgresHealthIndicator,
                {
                    provide: TOKEN_DATABASE,
                    useValue: mockDb,
                },
            ],
        }).compile();

        service = module.get<PostgresHealthIndicator>(PostgresHealthIndicator);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('ping', () => {
        it('should execute SELECT 1 query successfully', async () => {
            mockDb.execute.mockResolvedValueOnce({});

            await expect(service.ping()).resolves.toBeUndefined();
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if database query fails', async () => {
            mockDb.execute.mockRejectedValueOnce(new Error());

            await expect(service.ping()).rejects.toThrow(Error);
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });
    });
});
