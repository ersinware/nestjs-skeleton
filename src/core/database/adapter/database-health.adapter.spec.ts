/**
 * @file database-health.adapter.spec.ts
 * @description Unit tests for the PostgreSQL database health indicator service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { TOKEN_DATABASE } from 'src/core/database/database-client.token';
import { ConnectionLogMessage, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('PostgresHealthIndicatorAdapter', () => {
    const mockDb = {
        execute: vi.fn(),
    };

    const mockLoggerPort = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies ILoggerPort;

    let adapter: DatabaseHealthAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DatabaseHealthAdapter,
                {
                    provide: TOKEN_DATABASE,
                    useValue: mockDb,
                },
                {
                    provide: TOKEN_LOGGER_PORT,
                    useValue: mockLoggerPort,
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

        it('should warn once on the transition down and stay silent while the outage persists', async () => {
            mockDb.execute.mockRejectedValue(new Error());

            await expect(adapter.ping()).rejects.toThrow(Error);

            expect(mockLoggerPort.warn).toHaveBeenCalledTimes(1);
            expect(mockLoggerPort.warn).toHaveBeenCalledWith(
                expect.objectContaining({ message: ConnectionLogMessage.LOST }),
            );

            await expect(adapter.ping()).rejects.toThrow(Error);

            expect(mockLoggerPort.warn).toHaveBeenCalledTimes(1);
        });

        it('should log once on the transition back up and stay silent while healthy', async () => {
            mockDb.execute.mockRejectedValueOnce(new Error());
            await expect(adapter.ping()).rejects.toThrow(Error);

            mockDb.execute.mockResolvedValue({});
            await expect(adapter.ping()).resolves.toBeUndefined();

            expect(mockLoggerPort.log).toHaveBeenCalledTimes(1);
            expect(mockLoggerPort.log).toHaveBeenCalledWith(
                expect.objectContaining({ message: ConnectionLogMessage.RESTORED }),
            );

            await expect(adapter.ping()).resolves.toBeUndefined();

            expect(mockLoggerPort.log).toHaveBeenCalledTimes(1);
        });
    });
});
