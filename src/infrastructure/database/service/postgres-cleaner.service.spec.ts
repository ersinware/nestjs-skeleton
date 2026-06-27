/**
 * @file postgres-cleaner.service.spec.ts
 * @description Unit tests for the PostgreSQL database cleaner service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_DATABASE } from 'src/common/port/database/database.constant';
import { PostgresCleaner } from './postgres-cleaner.service';

describe('PostgresCleaner', () => {
    const mockDb = {
        execute: vi.fn(),
    };

    let service: PostgresCleaner;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostgresCleaner,
                {
                    provide: TOKEN_DATABASE,
                    useValue: mockDb,
                },
            ],
        }).compile();

        service = module.get<PostgresCleaner>(PostgresCleaner);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('cleanup', () => {
        it('should execute truncation SQL on database successfully', async () => {
            mockDb.execute.mockResolvedValueOnce({});

            await expect(service.cleanup()).resolves.toBeUndefined();
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if database execution fails', async () => {
            mockDb.execute.mockRejectedValueOnce(new Error());

            await expect(service.cleanup()).rejects.toThrow();
            expect(mockDb.execute).toHaveBeenCalledTimes(1);
        });
    });
});
