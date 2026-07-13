/**
 * @file adapter.spec.ts
 * @description Unit tests for InboxLedgerAdapter, verifying the run-once idempotency logic.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TOKEN_DATABASE } from 'src/core/database/constant/constant';
import { InboxLedgerAdapter } from 'src/core/inbox-ledger/adapter';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

describe('InboxLedgerAdapter', () => {
    let adapter: InboxLedgerAdapter;
    let returning: Mock;
    let limit: Mock;
    let markInsertConflict: Mock;

    beforeEach(async () => {
        returning = vi.fn();
        limit = vi.fn();
        markInsertConflict = vi.fn();

        // tx.insert(...).values(...).onConflictDoNothing().returning(...)
        const txInsert = { values: vi.fn(), onConflictDoNothing: vi.fn(), returning };
        txInsert.values.mockReturnValue(txInsert);
        txInsert.onConflictDoNothing.mockReturnValue(txInsert);
        const txMock = { insert: vi.fn().mockReturnValue(txInsert) };

        // this.db.insert(...).values(...).onConflictDoNothing()  (markProcessed)
        const dbInsert = { values: vi.fn(), onConflictDoNothing: markInsertConflict };
        dbInsert.values.mockReturnValue(dbInsert);

        // this.db.select(...).from(...).where(...).limit(1)  (isProcessed)
        const selectChain = { from: vi.fn(), where: vi.fn(), limit };
        selectChain.from.mockReturnValue(selectChain);
        selectChain.where.mockReturnValue(selectChain);

        const dbMock = {
            transaction: vi.fn((work: (tx: unknown) => unknown) => work(txMock)),
            select: vi.fn().mockReturnValue(selectChain),
            insert: vi.fn().mockReturnValue(dbInsert),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [InboxLedgerAdapter, { provide: TOKEN_DATABASE, useValue: dbMock }],
        }).compile();

        adapter = module.get<InboxLedgerAdapter>(InboxLedgerAdapter);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('runOnce', () => {
        it('should run the work and return true when the event is new', async () => {
            returning.mockResolvedValueOnce([{ eventId: 'outbox-1' }]);
            const work = vi.fn().mockResolvedValue(undefined);

            await expect(adapter.runOnce('consumer-a', 'outbox-1', work)).resolves.toBe(true);
            expect(work).toHaveBeenCalledTimes(1);
        });

        it('should skip the work and return false when already processed', async () => {
            returning.mockResolvedValueOnce([]);
            const work = vi.fn();

            await expect(adapter.runOnce('consumer-a', 'outbox-1', work)).resolves.toBe(false);
            expect(work).not.toHaveBeenCalled();
        });
    });

    describe('isProcessed', () => {
        it('should return true when a marker exists', async () => {
            limit.mockResolvedValueOnce([{ eventId: 'outbox-1' }]);

            await expect(adapter.isProcessed('consumer-a', 'outbox-1')).resolves.toBe(true);
        });

        it('should return false when no marker exists', async () => {
            limit.mockResolvedValueOnce([]);

            await expect(adapter.isProcessed('consumer-a', 'outbox-1')).resolves.toBe(false);
        });
    });

    describe('markProcessed', () => {
        it('should insert the marker ignoring conflicts', async () => {
            markInsertConflict.mockResolvedValueOnce(undefined);

            await expect(adapter.markProcessed('consumer-a', 'outbox-1')).resolves.toBeUndefined();
            expect(markInsertConflict).toHaveBeenCalledTimes(1);
        });
    });
});
