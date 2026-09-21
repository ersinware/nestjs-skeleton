/**
 * @file user-refresh-reuse-notice.queue.ts
 * @description Dispatches user refresh-token reuse notice jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { SendUserRefreshReuseNoticeCommand } from 'src/module/user/application/command/send-user-refresh-reuse-notice/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Consumes durable refresh-token reuse notice jobs.
 */
@Injectable()
export class UserRefreshReuseNoticeQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.REFRESH_REUSE_NOTICE;

    /**
     * Email delivery cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Bounds email concurrency per process; provider quotas also depend on replica count.
     */
    readonly workerOptions = { localConcurrency: 2, pollingIntervalSeconds: 2 } as const;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch notice commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches a notice command for the referenced user.
     *
     * @param job Refresh-token reuse notice job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new SendUserRefreshReuseNoticeCommand(job.aggregateId));
    }
}
