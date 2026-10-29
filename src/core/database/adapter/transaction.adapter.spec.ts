/**
 * @file transaction.adapter.spec.ts
 * @description Verifies explicit transaction ownership, ambient context, and failure propagation.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TransactionAdapter } from 'src/core/database/adapter/transaction.adapter';
import { transactionStorage } from 'src/core/database/database-transaction-context';
import { DependencyUnavailableException, ExceptionKind, isExceptionOfKind } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('TransactionAdapter', () => {
    it('rejects start inside an ambient transaction without executing work or opening another transaction', async () => {
        const transaction = vi.fn();
        const work = vi.fn();
        const executor = {} as NodePgDatabase;
        const adapter = new TransactionAdapter({ transaction } as unknown as NodePgDatabase);

        await transactionStorage.run(executor, async () => {
            await expect(adapter.start(work)).rejects.toMatchObject({ kind: ExceptionKind.SYSTEM });
            expect(transactionStorage.getStore()).toBe(executor);
        });

        expect(work).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        expect(transactionStorage.getStore()).toBeUndefined();
    });

    it('rejects join without an ambient transaction before executing work', async () => {
        const transaction = vi.fn();
        const work = vi.fn();
        const adapter = new TransactionAdapter({ transaction } as unknown as NodePgDatabase);

        await expect(adapter.join(work)).rejects.toMatchObject({ kind: ExceptionKind.SYSTEM });

        expect(work).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('returns joined work without opening or committing a transaction', async () => {
        const transaction = vi.fn();
        const executor = {} as NodePgDatabase;
        const adapter = new TransactionAdapter({ transaction } as unknown as NodePgDatabase);

        await transactionStorage.run(executor, async () => {
            await expect(
                adapter.join(() => {
                    expect(transactionStorage.getStore()).toBe(executor);
                    return Promise.resolve('joined-result');
                }),
            ).resolves.toBe('joined-result');
            expect(transactionStorage.getStore()).toBe(executor);
        });

        expect(transaction).not.toHaveBeenCalled();
        expect(transactionStorage.getStore()).toBeUndefined();
    });

    it.each([
        { failure: new Error('constraint failure'), kind: undefined },
        {
            failure: Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }),
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        },
        { failure: new DependencyUnavailableException(), kind: ExceptionKind.DEPENDENCY_UNAVAILABLE },
    ])('propagates or translates joined work failures: $failure', async ({ failure, kind }) => {
        const adapter = new TransactionAdapter({} as NodePgDatabase);

        await transactionStorage.run({} as NodePgDatabase, async () => {
            const result = adapter.join(() => Promise.reject(failure));

            if (kind !== undefined && !isExceptionOfKind(failure, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                await expect(result).rejects.toMatchObject({ kind, cause: failure });
            } else {
                await expect(result).rejects.toBe(failure);
            }
        });

        expect(transactionStorage.getStore()).toBeUndefined();
    });

    it.each([
        { failure: new Error('commit failed'), kind: undefined },
        {
            failure: Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }),
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        },
    ])('propagates or translates transaction settlement failures: $failure', async ({ failure, kind }) => {
        const executor = {} as NodePgDatabase;
        const work = vi.fn(() => {
            expect(transactionStorage.getStore()).toBe(executor);
            return Promise.resolve('callback-result');
        });
        const transaction = vi.fn(async (callback: (tx: NodePgDatabase) => Promise<unknown>) => {
            await callback(executor);
            throw failure;
        });
        const adapter = new TransactionAdapter({ transaction } as unknown as NodePgDatabase);
        const result = adapter.start(work);

        if (kind === undefined) {
            await expect(result).rejects.toBe(failure);
        } else {
            await expect(result).rejects.toMatchObject({ kind, cause: failure });
        }

        expect(work).toHaveBeenCalledTimes(1);
        expect(transactionStorage.getStore()).toBeUndefined();
    });
});
