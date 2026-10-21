/**
 * @file admin-email-confirmation.queue.ts
 * @description Dispatches admin email confirmation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { SendAdminEmailConfirmationCommand } from 'src/module/admin/application/command/send-admin-email-confirmation/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';

/**
 * Consumes durable admin email confirmation jobs.
 */
@Injectable()
export class AdminEmailConfirmationQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = AdminJobQueue.EMAIL_CONFIRMATION;

    /**
     * Email delivery cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Keeps confirmation delivery responsive with bounded sequential email batches.
     */
    readonly workerOptions = { localConcurrency: 1, pollingIntervalSeconds: 3, batchSize: 5 } as const;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch email confirmation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches an email confirmation command for the referenced admin.
     *
     * @param job Email confirmation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(
            new SendAdminEmailConfirmationCommand(job.aggregateId, job.deliveryId, this.name),
        );
    }
}
