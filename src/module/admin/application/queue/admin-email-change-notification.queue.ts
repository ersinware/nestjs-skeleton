/**
 * @file admin-email-change-notification.queue.ts
 * @description Dispatches committed admin email-change notices through the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { SendAdminEmailChangeNotificationCommand } from 'src/module/admin/application/command/send-admin-email-change-notification/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';

/**
 * Consumes durable old-address notifications.
 */
@Injectable()
export class AdminEmailChangeNotificationQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = AdminJobQueue.EMAIL_CHANGE_NOTIFICATION;

    /**
     * Email delivery takes place outside the job transaction.
     */
    readonly transactional = false;

    /**
     * Allows delayed old-address notices and amortizes polling across deliveries.
     */
    readonly workerOptions = { localConcurrency: 1, pollingIntervalSeconds: 30, batchSize: 10 } as const;

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
        await this.commandPipeline.execute(new SendAdminEmailChangeNotificationCommand(job.deliveryId, this.name));
    }
}
