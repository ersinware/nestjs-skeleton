/**
 * @file email.processor.ts
 * @description BullMQ worker processor listening to the email queue and processing jobs.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import { Job } from 'bullmq';
import { JOB_WELCOME_ADMIN, TOKEN_MAILER_SERVICE, QUEUE_EMAIL } from 'src/common/port/email/email.constant';
import type { IMailerService } from 'src/common/port/email/mailer.service.interface';
import type { WelcomeAdminJobData } from 'src/common/port/email/welcome-admin-job-data.interface';
import * as Sentry from '@sentry/nestjs';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';

/**
 * Background worker processor that consumes and processes queued email jobs.
 */
@Processor(QUEUE_EMAIL)
export class EmailProcessor extends WorkerHost {
    /**
     * Creates an instance of EmailProcessor.
     *
     * @param mailerService Service responsible for email dispatch.
     * @param logger The injected Logger service.
     */
    constructor(
        @Inject(TOKEN_MAILER_SERVICE) private readonly mailerService: IMailerService,
        @Inject(TOKEN_LOGGER_SERVICE) private readonly logger: ILoggerService,
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
            case JOB_WELCOME_ADMIN: {
                const { email, name, password } = job.data;

                await this.mailerService.sendEmail(
                    email,
                    'Welcome',
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
            new LogPayload({
                class: this.constructor.name,
                method: this.onFailed.name,
                error,
                jobId: job.id,
                jobName: job.name,
            }),
        );
        Sentry.captureException(error);
    }
}
