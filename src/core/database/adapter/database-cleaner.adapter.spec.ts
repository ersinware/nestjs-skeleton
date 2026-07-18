/**
 * @file postgres-cleaner.adapter.spec.ts
 * @description Unit tests for the PostgreSQL database cleaner service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseCleanerAdapter } from 'src/core/database/adapter/database-cleaner.adapter';
import { TOKEN_DATABASE } from 'src/core/database/database-client.token';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('PostgresCleanerAdapter', () => {
    const mockDb = {
        execute: vi.fn(),
    };

    let adapter: DatabaseCleanerAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DatabaseCleanerAdapter,
                {
                    provide: TOKEN_DATABASE,
                    useValue: mockDb,
                },
            ],
        }).compile();

        adapter = module.get<DatabaseCleanerAdapter>(DatabaseCleanerAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('cleanup', () => {
        it('should execute truncation SQL on database successfully', async () => {
            mockDb.execute.mockResolvedValueOnce({});

            await expect(adapter.cleanup()).resolves.toBeUndefined();
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if database execution fails', async () => {
            mockDb.execute.mockRejectedValueOnce(new Error());

            await expect(adapter.cleanup()).rejects.toThrow();
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });
    });
});
