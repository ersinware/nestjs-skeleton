/**
 * @file user-email-confirmation.consumer.ts
 * @description Dispatches user email confirmation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job, JobQueueWorkerProfile } from 'src/core/job-queue';
import { SendUserEmailConfirmationCommand } from 'src/module/user/application/command/send-user-email-confirmation/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { TerminalJobException } from 'src/shared/exception';

/**
 * Consumes durable user email confirmation jobs.
 */
@Injectable()
export class UserEmailConfirmationConsumer implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.EMAIL_CONFIRMATION;

    /**
     * Email delivery cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Keeps confirmation delivery responsive with bounded sequential email batches.
     */
    readonly workerOptions = { profile: JobQueueWorkerProfile.MEDIUM, localConcurrency: 1, batchSize: 5 } as const;

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
        const recipientName = job.payload?.['recipientName'];
        if (typeof recipientName !== 'string') {
            throw new TerminalJobException('The email confirmation job has an invalid recipient name.');
        }

        await this.commandPipeline.execute(
            new SendUserEmailConfirmationCommand(job.aggregateId, job.deliveryId, this.name, recipientName),
        );
    }
}
