/**
 * @file email-queue.adapter.ts
 * @description BullMQ implementation of the IEmailQueuePort — enqueues claimed emails onto the email
 * queue for asynchronous delivery.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMAIL_JOB_NAME, EMAIL_QUEUE_NAME } from 'src/core/email/constant';
import type { IEmailQueuePort } from 'src/core/email/port';
import type { ClaimedEmail } from 'src/core/email/type';

/**
 * BullMQ queue for the email relay. Only the email identity travels on the queue; the processor
 * re-reads the durable row before sending.
 */
@Injectable()
export class EmailQueueAdapter implements IEmailQueuePort {
    /**
     * Creates an instance of EmailQueueAdapter.
     *
     * @param emailQueue - BullMQ queue injected using `@InjectQueue(EMAIL_QUEUE_NAME)`.
     */
    constructor(@InjectQueue(EMAIL_QUEUE_NAME) private readonly emailQueue: Queue) {}

    /**
     * Enqueues claimed emails, keyed by email id so re-dispatch is idempotent. Retry, backoff and
     * retention come from the queue's own `defaultJobOptions`.
     *
     * @param emails - The claimed emails to enqueue.
     * @throws Throws if the enqueue operation fails.
     */
    async queueEmails(emails: ClaimedEmail[]) {
        if (emails.length === 0) {
            return;
        }

        await this.emailQueue.addBulk(
            emails.map((email) => ({
                name: EMAIL_JOB_NAME,
                data: { id: email.id },
                opts: {
                    jobId: email.id,
                },
            })),
        );
    }
}
