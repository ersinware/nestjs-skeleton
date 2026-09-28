/**
 * @file user-email-confirmation.queue.ts
 * @description Dispatches user email confirmation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { SendUserEmailConfirmationCommand } from 'src/module/user/application/command/send-user-email-confirmation/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Consumes durable user email confirmation jobs.
 */
@Injectable()
export class UserEmailConfirmationQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.EMAIL_CONFIRMATION;

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
     * @param commandPipeline Pipeline used to dispatch email confirmation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches an email confirmation command for the referenced user.
     *
     * @param job Email confirmation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(
            new SendUserEmailConfirmationCommand(job.aggregateId, job.deliveryId, this.name),
        );
    }
}
