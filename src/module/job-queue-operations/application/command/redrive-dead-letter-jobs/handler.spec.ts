/**
 * @file handler.spec.ts
 * @description Verifies bounded redrive draining and failure propagation.
 */

import type { IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import { RedriveDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/handler';
import { describe, expect, it, vi } from 'vitest';

describe('RedriveDeadLetterJobsCommandHandler', () => {
    it('continues fixed-size batches until pg-boss reports no eligible jobs', async () => {
        const redriveDeadLetterJobs = vi
            .fn()
            .mockResolvedValueOnce(100)
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(0);
        const handler = new RedriveDeadLetterJobsCommandHandler({
            redriveDeadLetterJobs,
        } as unknown as IJobQueueDeadLetterOperatorPort);

        await handler.execute();

        expect(redriveDeadLetterJobs).toHaveBeenCalledTimes(3);
        expect(redriveDeadLetterJobs.mock.calls).toStrictEqual([[100], [100], [100]]);
    });

    it('propagates a failed batch so pg-boss can retry the remaining DLQ jobs', async () => {
        const error = new Error('Redrive batch failed.');
        const redriveDeadLetterJobs = vi.fn().mockResolvedValueOnce(100).mockRejectedValueOnce(error);
        const handler = new RedriveDeadLetterJobsCommandHandler({
            redriveDeadLetterJobs,
        } as unknown as IJobQueueDeadLetterOperatorPort);

        await expect(handler.execute()).rejects.toBe(error);
        expect(redriveDeadLetterJobs).toHaveBeenCalledTimes(2);
    });
});
