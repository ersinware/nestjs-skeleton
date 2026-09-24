/**
 * @file user-email-change-notification.queue.ts
 * @description Dispatches committed user email-change notices through the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { SendUserEmailChangeNotificationCommand } from 'src/module/user/application/command/send-user-email-change-notification/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Consumes durable old-address notifications.
 */
@Injectable()
export class UserEmailChangeNotificationQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.EMAIL_CHANGE_NOTIFICATION;

    /**
     * Email delivery takes place outside the job transaction.
     */
    readonly transactional = false;

    /**
     * Limits concurrent email attempts per process.
     */
    readonly workerOptions = { localConcurrency: 2, pollingIntervalSeconds: 2 } as const;

    /**
     * Initializes the command pipeline.
     *
     * @param commandPipeline Dispatches notice commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches a committed notification job.
     *
     * @param job Committed notification delivery
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new SendUserEmailChangeNotificationCommand(job.deliveryId));
    }
}
