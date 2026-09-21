/**
 * @file job-queue-operations-reader.adapter.spec.ts
 * @description Verifies exhaustive public redrive status mapping and sanitization.
 */

import type { DeadLetterRedriveOperation, IJobQueueDeadLetterReaderPort } from 'src/core/job-queue';
import { JobQueueOperationsReaderAdapter } from 'src/module/job-queue-operations/infrastructure/adapter/job-queue-operations-reader.adapter';
import { describe, expect, it, vi } from 'vitest';

describe('JobQueueOperationsReaderAdapter', () => {
    it.each([
        ['created', 'ACCEPTED'],
        ['retry', 'ACCEPTED'],
        ['active', 'RUNNING'],
        ['completed', 'COMPLETED'],
        ['failed', 'FAILED'],
        ['cancelled', 'CANCELLED'],
    ] as const)('maps pg-boss %s to public %s without leaking job internals', async (state, status) => {
        const createdOn = new Date('2026-09-21T12:00:00.000Z');
        const completedOn = state === 'completed' ? new Date('2026-09-21T12:01:00.000Z') : null;
        const operation: DeadLetterRedriveOperation = {
            id: 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f',
            state,
            createdOn,
            completedOn,
        };
        const getDeadLetterRedrive = vi.fn().mockResolvedValue(operation);
        const reader = new JobQueueOperationsReaderAdapter({
            getDeadLetterRedrive,
        } as unknown as IJobQueueDeadLetterReaderPort);

        await expect(reader.getRedrive(operation.id)).resolves.toStrictEqual({
            operationId: operation.id,
            status,
            createdOn,
            completedOn,
        });
    });

    it('returns null for a missing or expired operation', async () => {
        const getDeadLetterRedrive = vi.fn().mockResolvedValue(null);
        const reader = new JobQueueOperationsReaderAdapter({
            getDeadLetterRedrive,
        } as unknown as IJobQueueDeadLetterReaderPort);

        await expect(reader.getRedrive('b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f')).resolves.toBeNull();
    });
});
