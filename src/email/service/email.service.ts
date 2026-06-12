/**
 * @file email.service.ts
 * @description Service implementation using BullMQ to queue e-mail dispatch tasks asynchronously.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { WelcomeAdminJobData } from '../type/email.type';
import type { IEmailService } from '../interface/email.service.interface';
import { JOB_NAME_WELCOME_ADMIN, QUEUE_NAME_EMAIL } from '../constant/email.constant';

@Injectable()
export class EmailService implements IEmailService {
    /**
     * Creates an instance of EmailService.
     *
     * @param emailQueue BullMQ queue injected using `@InjectQueue(QUEUE_NAME_EMAIL)`.
     */
    constructor(@InjectQueue(QUEUE_NAME_EMAIL) private readonly emailQueue: Queue) {}

    /**
     * Dispatches a welcome email to a newly created admin with their generated credentials.
     *
     * @param data The job payload containing recipient and credentials.
     */
    async sendAdminWelcomeEmail(data: WelcomeAdminJobData) {
        await this.emailQueue.add(JOB_NAME_WELCOME_ADMIN, data, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: true,
            removeOnFail: false,
        });
    }
}
