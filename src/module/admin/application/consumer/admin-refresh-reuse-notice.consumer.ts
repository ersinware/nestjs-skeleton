/**
 * @file admin-refresh-reuse-notice.consumer.ts
 * @description Dispatches admin refresh-token reuse notice jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job, JobQueueWorkerProfile } from 'src/core/job-queue';
import { SendAdminRefreshReuseNoticeCommand } from 'src/module/admin/application/command/send-admin-refresh-reuse-notice/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { TerminalJobException } from 'src/shared/exception';

/**
 * Consumes durable refresh-token reuse notice jobs.
 */
@Injectable()
export class AdminRefreshReuseNoticeConsumer implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = AdminJobQueue.REFRESH_REUSE_NOTICE;

    /**
     * Email delivery cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Allows modest notice delay and amortizes polling across deliveries.
     */
    readonly workerOptions = { profile: JobQueueWorkerProfile.LOW, localConcurrency: 1, batchSize: 5 } as const;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch notice commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches a notice command for the referenced admin.
     *
     * @param job Refresh-token reuse notice job
     */
    async consume(job: Job) {
        const recipientEmail = job.payload?.['recipientEmail'];
        if (typeof recipientEmail !== 'string') {
            throw new TerminalJobException('The refresh-reuse notice job has an invalid recipient address.');
        }

        const recipientName = job.payload?.['recipientName'];
        if (typeof recipientName !== 'string') {
            throw new TerminalJobException('The refresh-reuse notice job has an invalid recipient name.');
        }

        await this.commandPipeline.execute(
            new SendAdminRefreshReuseNoticeCommand(job.deliveryId, this.name, recipientEmail, recipientName),
        );
    }
}
