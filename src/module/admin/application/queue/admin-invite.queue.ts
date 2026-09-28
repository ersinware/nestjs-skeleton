/**
 * @file admin-invite.queue.ts
 * @description Dispatches admin invitation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { SendAdminInviteCommand } from 'src/module/admin/application/command/send-admin-invite/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';

/**
 * Consumes durable admin invitation jobs.
 */
@Injectable()
export class AdminInviteQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = AdminJobQueue.INVITE;

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
     * @param commandPipeline Pipeline used to dispatch invitation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches an invitation command for the referenced admin.
     *
     * @param job Invitation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new SendAdminInviteCommand(job.aggregateId, job.deliveryId, this.name));
    }
}
