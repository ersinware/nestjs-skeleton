/**
 * @file handler.spec.ts
 * @description Verifies exclusive redrive enqueueing, audit correlation, and conflict handling.
 */

import type { IIdempotencyPort } from 'src/core/idempotency';
import type { IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import type { IAuditPort } from 'src/core/observability/audit';
import { StartDeadLetterRedriveCommand } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/command';
import { StartDeadLetterRedriveCommandHandler } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/handler';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceConflictException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('StartDeadLetterRedriveCommandHandler', () => {
    const idempotencyRequest = {
        key: '00000000-0000-4000-8000-000000000001',
        canonicalValue: '["POST","/api/v1/job-operation/dead-letter/redrive"]',
    };

    function createHandler(accepted: boolean) {
        const execute = vi.fn<IIdempotencyPort['execute']>().mockImplementation((_request, work) => work());
        const enqueueDeadLetterRedrive = vi
            .fn<IJobQueueDeadLetterOperatorPort['enqueueDeadLetterRedrive']>()
            .mockResolvedValue(accepted);
        const record = vi.fn<IAuditPort['record']>().mockResolvedValue(undefined);

        const handler = new StartDeadLetterRedriveCommandHandler(
            { execute, executePrepared: vi.fn() } satisfies IIdempotencyPort,
            { enqueueDeadLetterRedrive } as unknown as IJobQueueDeadLetterOperatorPort,
            { record } satisfies IAuditPort,
        );

        return { handler, execute, enqueueDeadLetterRedrive, record };
    }

    it('enqueues an exclusive redrive and records the generated redriveId in audit', async () => {
        const { handler, execute, enqueueDeadLetterRedrive, record } = createHandler(true);

        await handler.execute(new StartDeadLetterRedriveCommand(idempotencyRequest));

        expect(execute).toHaveBeenCalledTimes(1);
        expect(enqueueDeadLetterRedrive).toHaveBeenCalledTimes(1);
        const redriveId = enqueueDeadLetterRedrive.mock.calls[0]?.[0];
        expect(redriveId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(record).toHaveBeenCalledWith({
            action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED,
            detail: { redriveId },
        });
    });

    it('throws ResourceConflictException without auditing when a redrive is already in progress', async () => {
        const { handler, record } = createHandler(false);

        await expect(handler.execute(new StartDeadLetterRedriveCommand(idempotencyRequest))).rejects.toBeInstanceOf(
            ResourceConflictException,
        );
        expect(record).not.toHaveBeenCalled();
    });
});
