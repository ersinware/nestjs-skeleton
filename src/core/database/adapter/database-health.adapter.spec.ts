/**
 * @file database-health.adapter.spec.ts
 * @description Unit tests for the PostgreSQL database health adapter.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { DatabaseRole } from 'src/core/database/database-role.enum';
import { ConnectionLogMessage, type ILoggerPort } from 'src/core/observability/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('DatabaseHealthAdapter', () => {
    const mockDb = {
        execute: vi.fn(),
    };

    const mockLoggerPort = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies ILoggerPort;

    let adapter: DatabaseHealthAdapter;

    beforeEach(() => {
        adapter = new DatabaseHealthAdapter(mockDb as unknown as NodePgDatabase, mockLoggerPort, DatabaseRole.PRIMARY);
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
                expect.objectContaining({ message: ConnectionLogMessage.LOST, data: { role: DatabaseRole.PRIMARY } }),
            );

            await expect(adapter.ping()).rejects.toThrow(Error);

            expect(mockLoggerPort.warn).toHaveBeenCalledTimes(1);
        });

        it('should log once on the transition back up and stay silent while healthy', async () => {
            mockDb.execute.mockRejectedValueOnce(new Error());
            await expect(adapter.ping()).rejects.toThrow(Error);

            mockDb.execute.mockResolvedValue({});
            await expect(adapter.ping()).resolves.toBeUndefined();

            expect(mockLoggerPort.info).toHaveBeenCalledTimes(1);
            expect(mockLoggerPort.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: ConnectionLogMessage.RESTORED,
                    data: { role: DatabaseRole.PRIMARY },
                }),
            );

            await expect(adapter.ping()).resolves.toBeUndefined();

            expect(mockLoggerPort.info).toHaveBeenCalledTimes(1);
        });
    });
});
