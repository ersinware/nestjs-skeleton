/**
 * @file email.processor.ts
 * @description BullMQ worker processor listening to the email queue and processing jobs.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { JOB_SEND_EMAIL, QUEUE_EMAIL } from 'src/core/email/constant';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email/port';
import type { EmailPayload } from 'src/core/email/type';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';

/**
 * Background worker processor that consumes and processes queued email jobs.
 */
@Processor(QUEUE_EMAIL)
export class EmailProcessor extends WorkerHost {
    /**
     * Creates an instance of EmailProcessor.
     *
     * @param emailerPort Service responsible for email dispatch.
     */
    constructor(
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
    ) {
        super();
    }

    /**
     * Handles processing of incoming queue jobs in the background.
     *
     * @param job The queue job payload containing details of the email target and data parameters.
     */
    async process(job: Job<EmailPayload, unknown, string>) {
        switch (job.name) {
            case JOB_SEND_EMAIL: {
                await this.emailerPort.sendEmail(job.data);

                break;
            }
            default:
                throw new Error(`Unknown job name: ${job.name}`);
        }
    }

    /**
     * Handles failed jobs when all retry attempts have been exhausted.
     * Logs the error and captures the exception for monitoring.
     *
     * @param job The queue job that failed.
     * @param error The error thrown during processing.
     */
    @OnWorkerEvent('failed')
    onFailed(job: Job<EmailPayload, unknown, string>, error: Error) {
        if (job.attemptsMade < (job.opts.attempts ?? 0)) {
            return;
        }

        this.loggerPort.error(
            new LogPayload({
                class: EmailProcessor.name,
                method: this.onFailed.name,
                error,
                queue: QUEUE_EMAIL,
                jobId: job.id,
            }),
        );
        this.exceptionTrackerPort.captureException(error);
    }
}
