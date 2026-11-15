/**
 * @file job-queue-operations-dead-letter-reader.adapter.spec.ts
 * @description Verifies pg-boss redrive state mapping and pagination forwarding.
 */

import type { DeadLetterRedrive, IJobQueueDeadLetterReaderPort } from 'src/core/job-queue';
import { JobQueueOperationsDeadLetterReaderAdapter } from 'src/module/job-queue-operations/infrastructure/adapter/job-queue-operations-dead-letter-reader.adapter';
import { describe, expect, it, vi } from 'vitest';

describe('JobQueueOperationsDeadLetterReaderAdapter', () => {
    it.each<[DeadLetterRedrive['state'], string, Date | null]>([
        ['created', 'ACCEPTED', null],
        ['retry', 'ACCEPTED', null],
        ['active', 'RUNNING', null],
        ['completed', 'COMPLETED', new Date('2026-11-15T10:05:00Z')],
        ['failed', 'FAILED', new Date('2026-11-15T10:05:00Z')],
        ['cancelled', 'CANCELLED', new Date('2026-11-15T10:05:00Z')],
    ])('maps pg-boss state %s to %s', async (state, expectedStatus, completedOn) => {
        const createdOn = new Date('2026-11-15T10:00:00Z');
        const id = '00000000-0000-4000-8000-000000000010';
        const listDeadLetterRedrives = vi
            .fn<IJobQueueDeadLetterReaderPort['listDeadLetterRedrives']>()
            .mockResolvedValue({
                data: [{ id, state, createdOn, completedOn }],
                total: 1,
            });
        const adapter = new JobQueueOperationsDeadLetterReaderAdapter({
            listDeadLetterRedrives,
        } as unknown as IJobQueueDeadLetterReaderPort);

        const page = await adapter.listDeadLetterRedrives({ page: 1, limit: 20 });

        expect(listDeadLetterRedrives).toHaveBeenCalledWith({ page: 1, limit: 20 });
        expect(page).toStrictEqual({
            data: [{ id, status: expectedStatus, createdOn, completedOn }],
            total: 1,
        });
    });

    it('propagates errors from the core dead-letter reader port', async () => {
        const error = new Error('Database unavailable.');
        const listDeadLetterRedrives = vi
            .fn<IJobQueueDeadLetterReaderPort['listDeadLetterRedrives']>()
            .mockRejectedValue(error);
        const adapter = new JobQueueOperationsDeadLetterReaderAdapter({
            listDeadLetterRedrives,
        } as unknown as IJobQueueDeadLetterReaderPort);

        await expect(adapter.listDeadLetterRedrives({ page: 1, limit: 20 })).rejects.toBe(error);
    });
});
