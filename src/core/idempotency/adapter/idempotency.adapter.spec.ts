/**
 * @file idempotency.adapter.spec.ts
 * @description Verifies port delegation, minimal writes, replay, and read failure propagation.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ITransactionPort } from 'src/core/database';
import { IdempotencyAdapter } from 'src/core/idempotency/adapter/idempotency.adapter';
import type { IHashingPort } from 'src/core/security/hashing';
import { ExceptionKind } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('IdempotencyAdapter', () => {
    const input = { key: '00c7a6cd-5bcc-4ac6-9a7c-7a50fe34c48e', canonicalValue: '["POST","/probe","credential"]' };
    const hashing = {
        hashPassword: vi.fn(),
        verifyPassword: vi.fn(),
        simulatePasswordVerify: vi.fn(),
        hmacSha256: vi.fn(() => 'opaque-digest'),
        verifyHmacSha256: vi.fn(),
    } satisfies IHashingPort;
    const start = vi.fn();
    const transactions = {
        start: <T>(work: () => Promise<T>): Promise<T> => {
            start();
            return work();
        },
        join: vi.fn(),
    } satisfies ITransactionPort;
    const read = vi.fn();
    const returning = vi.fn();
    const values = vi.fn();
    const update = vi.fn();
    const database = {
        select: () => ({ from: () => ({ where: read }) }),
        insert: () => ({ values }),
        update,
    } as unknown as NodePgDatabase;
    const adapter = new IdempotencyAdapter(database, transactions, hashing);

    beforeEach(() => {
        read.mockResolvedValue([]);
        returning.mockResolvedValue([{ key: input.key }]);
        values.mockReturnValue({ onConflictDoNothing: () => ({ returning }) });
    });

    it('uses the shared context-separated hashing port and persists no raw input for a 204 result', async () => {
        const work = vi.fn(() => Promise.resolve({ replayResultId: null }));
        await expect(adapter.execute(input, work)).resolves.toStrictEqual({ replayResultId: null });
        expect(hashing.hmacSha256).toHaveBeenCalledWith('idempotency-fingerprint', input.canonicalValue);
        expect(values).toHaveBeenCalledWith({ key: input.key, fingerprint: 'opaque-digest' });
        expect(start).toHaveBeenCalledTimes(1);
        expect(work).toHaveBeenCalledTimes(1);
        expect(update).not.toHaveBeenCalled();
    });

    it('replays a retained null result without calling mutation', async () => {
        returning.mockResolvedValue([]);
        read.mockResolvedValue([{ fingerprint: 'opaque-digest', replayResultId: null }]);
        const work = vi.fn();
        await expect(adapter.execute(input, work)).resolves.toStrictEqual({ replayResultId: null });
        expect(work).not.toHaveBeenCalled();
    });

    it('rejects fingerprint conflicts without business effects', async () => {
        returning.mockResolvedValue([]);
        read.mockResolvedValue([{ fingerprint: 'different', replayResultId: null }]);
        const work = vi.fn();
        await expect(adapter.execute(input, work)).rejects.toMatchObject({ kind: ExceptionKind.RESOURCE_CONFLICT });
        expect(work).not.toHaveBeenCalled();
    });

    it('reports a missing retained claim as a system fault', async () => {
        returning.mockResolvedValue([]);
        const work = vi.fn();
        await expect(adapter.execute(input, work)).rejects.toMatchObject({ kind: ExceptionKind.SYSTEM });
        expect(work).not.toHaveBeenCalled();
    });

    it('translates preparation lookup connection failures and skips preparation', async () => {
        read.mockRejectedValueOnce(Object.assign(new Error('Connection refused.'), { code: 'ECONNREFUSED' }));
        const prepare = vi.fn();
        const work = vi.fn();
        await expect(adapter.executePrepared(input, prepare, work)).rejects.toMatchObject({
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        });
        expect(prepare).not.toHaveBeenCalled();
        expect(work).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
    });

    it('preserves unexpected read failures without preparing or claiming', async () => {
        const error = new Error('Query error.');
        read.mockRejectedValueOnce(error);
        const prepare = vi.fn();
        await expect(adapter.executePrepared(input, prepare, vi.fn())).rejects.toBe(error);
        expect(prepare).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
    });
});
