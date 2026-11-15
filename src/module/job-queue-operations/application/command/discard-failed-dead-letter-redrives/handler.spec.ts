/**
 * @file handler.spec.ts
 * @description Verifies failed redrive discard outcomes, audit recording, and failure handling.
 */

import type { IIdempotencyPort } from 'src/core/idempotency';
import { RedriveDiscardOutcome, type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import type { IAuditPort } from 'src/core/observability/audit';
import { DiscardFailedDeadLetterRedrivesCommand } from 'src/module/job-queue-operations/application/command/discard-failed-dead-letter-redrives/command';
import { DiscardFailedDeadLetterRedrivesCommandHandler } from 'src/module/job-queue-operations/application/command/discard-failed-dead-letter-redrives/handler';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceConflictException, ResourceNotFoundException, SystemException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('DiscardFailedDeadLetterRedrivesCommandHandler', () => {
    const idempotencyRequest = {
        key: '00000000-0000-4000-8000-000000000001',
        canonicalValue: '["POST","/api/v1/job-operation/dead-letter/redrive/discard"]',
    };

    function createHandler(outcome: RedriveDiscardOutcome) {
        const execute = vi.fn<IIdempotencyPort['execute']>().mockImplementation((_request, work) => work());
        const discardFailedDeadLetterRedrives = vi
            .fn<IJobQueueDeadLetterOperatorPort['discardFailedDeadLetterRedrives']>()
            .mockResolvedValue(outcome);
        const record = vi.fn<IAuditPort['record']>().mockResolvedValue(undefined);

        const handler = new DiscardFailedDeadLetterRedrivesCommandHandler(
            { execute, executePrepared: vi.fn() } satisfies IIdempotencyPort,
            { discardFailedDeadLetterRedrives } as unknown as IJobQueueDeadLetterOperatorPort,
            { record } satisfies IAuditPort,
        );

        return { handler, execute, discardFailedDeadLetterRedrives, record };
    }

    it('records an audit entry when every requested failed redrive is discarded', async () => {
        const ids = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'];
        const { handler, execute, discardFailedDeadLetterRedrives, record } = createHandler(
            RedriveDiscardOutcome.DISCARDED,
        );

        await handler.execute(new DiscardFailedDeadLetterRedrivesCommand(idempotencyRequest, ids));

        expect(execute).toHaveBeenCalledTimes(1);
        expect(discardFailedDeadLetterRedrives).toHaveBeenCalledWith(ids);
        expect(record).toHaveBeenCalledWith({
            action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_DISCARDED,
            detail: { ids },
        });
    });

    it('throws ResourceNotFoundException without auditing when any redrive is missing', async () => {
        const ids = ['00000000-0000-4000-8000-000000000010'];
        const { handler, record } = createHandler(RedriveDiscardOutcome.NOT_FOUND);

        await expect(
            handler.execute(new DiscardFailedDeadLetterRedrivesCommand(idempotencyRequest, ids)),
        ).rejects.toBeInstanceOf(ResourceNotFoundException);
        expect(record).not.toHaveBeenCalled();
    });

    it('throws ResourceConflictException without auditing when any redrive is not failed', async () => {
        const ids = ['00000000-0000-4000-8000-000000000010'];
        const { handler, record } = createHandler(RedriveDiscardOutcome.NOT_FAILED);

        await expect(
            handler.execute(new DiscardFailedDeadLetterRedrivesCommand(idempotencyRequest, ids)),
        ).rejects.toBeInstanceOf(ResourceConflictException);
        expect(record).not.toHaveBeenCalled();
    });

    it('throws SystemException without auditing when the port returns an unknown outcome', async () => {
        const ids = ['00000000-0000-4000-8000-000000000010'];
        const { handler, record } = createHandler('UNEXPECTED' as RedriveDiscardOutcome);

        await expect(
            handler.execute(new DiscardFailedDeadLetterRedrivesCommand(idempotencyRequest, ids)),
        ).rejects.toBeInstanceOf(SystemException);
        expect(record).not.toHaveBeenCalled();
    });
});
