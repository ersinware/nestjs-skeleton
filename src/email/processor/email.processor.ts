/**
 * @file email.processor.ts
 * @description BullMQ worker processor listening to the email queue and processing jobs.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import { Job } from 'bullmq';
import { JOB_NAME_WELCOME_ADMIN, QUEUE_NAME_EMAIL } from '../constant/email.constant';
import { GmailService } from '../service/gmail.service';
import type { WelcomeAdminJobData } from '../type/email.type';
import * as Sentry from '@sentry/nestjs';

@Processor(QUEUE_NAME_EMAIL)
export class EmailProcessor extends WorkerHost {
    /**
     * Creates an instance of EmailProcessor.
     *
     * @param gmailService Service responsible for Gmail API integration.
     * @param logger The injected Logger service.
     */
    constructor(
        private readonly gmailService: GmailService,
        private readonly logger: Logger,
    ) {
        super();
    }

    /**
     * Handles processing of incoming queue jobs in the background.
     *
     * @param job The queue job payload containing details of the email target and data parameters.
     */
    async process(job: Job<WelcomeAdminJobData, unknown, string>) {
        switch (job.name) {
            case JOB_NAME_WELCOME_ADMIN: {
                const { email, name, password } = job.data;

                await this.gmailService.sendEmail(
                    email,
                    'Welcome to NestJS Skeleton',
                    `<p>Hello ${name},</p><p>Your administrator account has been created.</p><p>Temporary Password: <strong>${password}</strong></p>`,
                );

                break;
            }
            default:
                throw new Error(`Unknown job name: ${job.name}`);
        }
    }

    /**
     * Event listener triggered automatically when an email queue job fails.
     * Logs the failure to standard output / error.
     *
     * @param job The failed queue job instance.
     * @param error The error thrown during job processing.
     */
    @OnWorkerEvent('failed')
    onFailed(job: Job<WelcomeAdminJobData, unknown, string>, error: Error) {
        this.logger.error(
            { error, class: 'EmailProcessor', method: 'onFailed', jobId: job.id, jobName: job.name },
            'Job failed',
        );
        Sentry.captureException(error);
    }
}
