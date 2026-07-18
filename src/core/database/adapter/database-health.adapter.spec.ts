/**
 * @file postgres-health-indicator.adapter.spec.ts
 * @description Unit tests for the PostgreSQL database health indicator service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { TOKEN_DATABASE } from 'src/core/database/database-client.token';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('PostgresHealthIndicatorAdapter', () => {
    const mockDb = {
        execute: vi.fn(),
    };

    let adapter: DatabaseHealthAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DatabaseHealthAdapter,
                {
                    provide: TOKEN_DATABASE,
                    useValue: mockDb,
                },
            ],
        }).compile();

        adapter = module.get<DatabaseHealthAdapter>(DatabaseHealthAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('ping', () => {
        it('should execute SELECT 1 query successfully', async () => {
            mockDb.execute.mockResolvedValueOnce({});

            await expect(adapter.ping()).resolves.toBeUndefined();
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if database query fails', async () => {
            mockDb.execute.mockRejectedValueOnce(new Error());

            await expect(adapter.ping()).rejects.toThrow(Error);
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });
    });
});
