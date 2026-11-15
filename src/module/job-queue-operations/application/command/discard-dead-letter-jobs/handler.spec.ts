/**
 * @file handler.spec.ts
 * @description Verifies exact-ID dead-letter job discard, audit recording, and partial/missing rejection.
 */

import type { IIdempotencyPort } from 'src/core/idempotency';
import type { IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import type { IAuditPort } from 'src/core/observability/audit';
import { DiscardDeadLetterJobsCommand } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/command';
import { DiscardDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/handler';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceNotFoundException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('DiscardDeadLetterJobsCommandHandler', () => {
    const idempotencyRequest = {
        key: '00000000-0000-4000-8000-000000000001',
        canonicalValue: '["POST","/api/v1/job-operation/dead-letter/job/discard"]',
    };

    function createHandler(affected: number) {
        const execute = vi.fn<IIdempotencyPort['execute']>().mockImplementation((_request, work) => work());
        const discardDeadLetterJobs = vi
            .fn<IJobQueueDeadLetterOperatorPort['discardDeadLetterJobs']>()
            .mockResolvedValue(affected);
        const record = vi.fn<IAuditPort['record']>().mockResolvedValue(undefined);

        const handler = new DiscardDeadLetterJobsCommandHandler(
            { execute, executePrepared: vi.fn() } satisfies IIdempotencyPort,
            { discardDeadLetterJobs } as unknown as IJobQueueDeadLetterOperatorPort,
            { record } satisfies IAuditPort,
        );

        return { handler, execute, discardDeadLetterJobs, record };
    }

    it('records an audit entry when every requested dead-letter job is discarded', async () => {
        const ids = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'];
        const { handler, execute, discardDeadLetterJobs, record } = createHandler(ids.length);

        await handler.execute(new DiscardDeadLetterJobsCommand(idempotencyRequest, ids));

        expect(execute).toHaveBeenCalledTimes(1);
        expect(discardDeadLetterJobs).toHaveBeenCalledWith(ids);
        expect(record).toHaveBeenCalledWith({
            action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_DISCARDED,
            detail: { ids, count: '2' },
        });
    });

    it('throws ResourceNotFoundException without auditing when fewer rows than requested are deleted', async () => {
        const ids = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'];
        const { handler, record } = createHandler(1);

        await expect(handler.execute(new DiscardDeadLetterJobsCommand(idempotencyRequest, ids))).rejects.toBeInstanceOf(
            ResourceNotFoundException,
        );
        expect(record).not.toHaveBeenCalled();
    });
});
