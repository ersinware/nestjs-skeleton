/**
 * @file handler.spec.ts
 * @description Logout-all durable routing and transaction-bound audit coverage.
 */

import type { ITransactionPort } from 'src/core/database';
import type { IJobQueueWriterPort } from 'src/core/job-queue';
import { type IAuditPort } from 'src/core/observability/audit';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { LogoutAllCommandHandler } from 'src/module/auth/application/command/logout-all/handler';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('LogoutAllCommandHandler', () => {
    const enqueue = vi.fn<IJobQueueWriterPort['enqueue']>();
    const start = vi.fn<ITransactionPort['start']>();
    const record = vi.fn<IAuditPort['record']>();
    let handler: LogoutAllCommandHandler;

    beforeEach(() => {
        enqueue.mockResolvedValue(undefined);
        record.mockResolvedValue(undefined);
        start.mockImplementation(async (callback: () => Promise<unknown>) => callback());
        handler = new LogoutAllCommandHandler({ enqueue }, { start, join: vi.fn() } as unknown as ITransactionPort, {
            record,
        });
    });

    it.each([
        { principalType: PrincipalType.USER, queueName: UserSessionRevocationJobQueue.LOGOUT_ALL },
        { principalType: PrincipalType.ADMIN, queueName: AdminSessionRevocationJobQueue.LOGOUT_ALL },
    ])('routes $principalType revocation to its owner queue', async ({ principalType, queueName }) => {
        await handler.execute(new LogoutAllCommand('principal-1', principalType));

        expect(start).toHaveBeenCalledTimes(1);
        const job = enqueue.mock.calls[0]?.[0][0];
        expect(job?.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
        expect(job).toMatchObject({ aggregateId: 'principal-1', queueName });
        expect(record).toHaveBeenCalledWith({
            action: AuthAuditAction.LOGOUT_ALL,
            detail: { deliveryId: job?.deliveryId },
        });
    });

    it('propagates a required durable-write failure', async () => {
        const failure = new Error('job enqueue failed');
        enqueue.mockRejectedValueOnce(failure);

        await expect(handler.execute(new LogoutAllCommand('principal-1', PrincipalType.USER))).rejects.toBe(failure);
    });
});
