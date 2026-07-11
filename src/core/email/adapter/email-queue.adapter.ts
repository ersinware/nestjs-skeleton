/**
 * @file email.service.ts
 * @description Service implementation using BullMQ to queue e-mail dispatch tasks asynchronously.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_SEND_EMAIL, QUEUE_EMAIL } from 'src/core/email/constant';
import type { IEmailQueuePort } from 'src/core/email/port';
import type { EmailPayload } from 'src/core/email/type';

/**
 * Service implementation responsible for queuing asynchronous email jobs using BullMQ.
 */
@Injectable()
export class EmailQueueAdapter implements IEmailQueuePort {
    /**
     * Creates an instance of EmailAdapter.
     *
     * @param emailQueue BullMQ queue injected using `@InjectQueue(QUEUE_EMAIL)`.
     */
    constructor(@InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue) {}

    /**
     * Queues an email to be dispatched asynchronously.
     *
     * @param data The email job data containing recipient, subject, and body
     */
    async queueEmail(data: EmailPayload, jobId: string) {
        await this.emailQueue.add(JOB_SEND_EMAIL, data, {
            jobId,
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: {
                age: 24 * 60 * 60,
                count: 1000,
            },
            removeOnFail: false,
        });
    }
}
