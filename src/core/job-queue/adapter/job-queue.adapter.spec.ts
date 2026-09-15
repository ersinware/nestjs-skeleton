/**
 * @file job-queue.adapter.spec.ts
 * @description Verifies error ownership and cleanup when delivery lifecycle operations fail.
 */

import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { JobQueueAdapter } from 'src/core/job-queue/adapter/job-queue.adapter';
import { ConnectionLogMessage } from 'src/core/observability/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Controls dependency failures without substituting for PostgreSQL integration checks.
 */
const dependencies = vi.hoisted(() => ({
    pool: { on: vi.fn(), query: vi.fn(), end: vi.fn() },
    clients: [] as {
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        emit: (event: string, ...args: unknown[]) => boolean;
    }[],
    inspect: vi.fn(),
}));

vi.mock('src/core/database', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/core/database')>()),
    createDatabasePool: () => dependencies.pool,
}));
vi.mock('src/core/job-queue/job-queue-schema.util', () => ({ assertJobQueueSchema: dependencies.inspect }));
vi.mock('pg-boss', async () => {
    const { EventEmitter } = await import('node:events');

    return {
        fromDrizzle: vi.fn(),
        PgBoss: class extends EventEmitter {
            /**
             * Allows individual clients to reject startup.
             */
            start = vi.fn().mockResolvedValue(undefined);
            /**
             * Allows independent shutdown failures.
             */
            stop = vi.fn().mockResolvedValue(undefined);

            /**
             * Records clients for lifecycle fault injection.
             */
            constructor() {
                super();
                dependencies.clients.push(this);
            }
        },
    };
});

describe('JobQueueAdapter lifecycle', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const reporter = { report: vi.fn() };
    let storage: JobQueueAdapter;

    beforeEach(() => {
        dependencies.clients.length = 0;
        dependencies.pool.end.mockReset().mockResolvedValue(undefined);
        dependencies.pool.query.mockReset().mockResolvedValue({ rows: [] });
        dependencies.inspect.mockReset().mockResolvedValue(undefined);
        storage = new JobQueueAdapter(
            new ConfigService({ DATABASE_URL: 'postgres://unused', DELIVERY_POOL_SIZE: 2 }),
            logger,
            reporter,
            {} as NodePgDatabase,
            { run: vi.fn() },
        );

        for (const schema of ['first_jobs', 'second_jobs', 'third_jobs']) {
            storage.register({ schema, queues: ['sample.task'] });
        }
    });

    it('closes all clients and the shared pool exactly once for concurrent shutdown calls', async () => {
        await storage.onApplicationBootstrap();
        await Promise.all([storage.beforeApplicationShutdown(), storage.beforeApplicationShutdown()]);

        for (const client of dependencies.clients) {
            expect(client.stop).toHaveBeenCalledExactlyOnceWith({ close: false });
        }
        expect(dependencies.pool.end).toHaveBeenCalledTimes(1);
    });

    it('cleans up all clients when startup fails and preserves the startup error', async () => {
        const failure = new Error('schema missing');
        dependencies.clients[1]!.start.mockRejectedValue(failure);

        await expect(storage.onApplicationBootstrap()).rejects.toBe(failure);
        expect(dependencies.clients[2]!.start).not.toHaveBeenCalled();
        expect(dependencies.clients.every((client) => client.stop.mock.calls.length === 1)).toBe(true);
        expect(dependencies.pool.end).toHaveBeenCalledTimes(1);
    });

    it('preserves the startup failure and reports cleanup failures separately', async () => {
        const startup = new Error('schema missing');
        const cleanup = new Error('client shutdown failed');
        dependencies.clients[0]!.start.mockRejectedValue(startup);
        dependencies.clients[1]!.stop.mockRejectedValue(cleanup);

        await expect(storage.onApplicationBootstrap()).rejects.toBe(startup);
        expect(reporter.report).toHaveBeenCalledTimes(1);
        expect(dependencies.pool.end).toHaveBeenCalledTimes(1);
    });

    it('retains every shutdown failure, including pool cleanup, after attempting all cleanup', async () => {
        const first = new Error('first client failed');
        const second = new Error('second client failed');
        const pool = new Error('pool shutdown failed');
        dependencies.clients[0]!.stop.mockRejectedValue(first);
        dependencies.clients[2]!.stop.mockRejectedValue(second);
        dependencies.pool.end.mockRejectedValue(pool);

        await expect(storage.beforeApplicationShutdown()).rejects.toMatchObject({
            cause: { errors: [first, second, pool] },
        });
        expect(dependencies.clients.every((client) => client.stop.mock.calls.length === 1)).toBe(true);
        expect(dependencies.pool.end).toHaveBeenCalledTimes(1);
    });

    it('deduplicates background connection failures within the same outage', () => {
        const listener = dependencies.pool.on.mock.calls.at(-1)![1] as (error: Error) => void;
        const error = Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
        listener(error);
        listener(error);

        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                message: ConnectionLogMessage.LOST,
                error,
            }),
        );
        expect(reporter.report).not.toHaveBeenCalled();
    });

    it('reports unexpected background errors without suppressing them as outages', () => {
        const listener = dependencies.pool.on.mock.calls.at(-1)![1] as (error: Error) => void;
        const error = new Error('unexpected vendor fault');
        listener(error);

        expect(reporter.report).toHaveBeenCalledExactlyOnceWith(
            error,
            expect.objectContaining({ class: 'JobQueueAdapter' }),
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('handles vendor warnings and errors before startup with their diagnostic context', () => {
        const error = new Error('vendor failure');
        dependencies.clients[0]!.emit('warning', { message: 'vendor warning' });
        dependencies.clients[0]!.emit('error', error);

        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ message: 'vendor warning', data: { schema: 'first_jobs' } }),
        );
        expect(reporter.report).toHaveBeenCalledExactlyOnceWith(
            error,
            expect.objectContaining({ class: 'JobQueueAdapter' }),
        );
    });
});
