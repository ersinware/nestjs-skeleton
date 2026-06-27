/**
 * @file email.service.ts
 * @description Service implementation using BullMQ to queue e-mail dispatch tasks asynchronously.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_WELCOME_ADMIN, QUEUE_EMAIL } from 'src/common/port/email/email.constant';
import type { WelcomeAdminJobData } from 'src/common/port/email/welcome-admin-job-data.interface';
import type { IEmailService } from 'src/common/port/email/email.service.interface';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import * as Sentry from '@sentry/nestjs';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';

/**
 * Service implementation responsible for queuing asynchronous email jobs using BullMQ.
 */
@Injectable()
export class EmailService implements IEmailService {
    /**
     * Creates an instance of EmailService.
     *
     * @param emailQueue BullMQ queue injected using `@InjectQueue(QUEUE_EMAIL)`.
     * @param logger Pino logger instance for structured logging.
     */
    constructor(
        @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
        @Inject(TOKEN_LOGGER_SERVICE) private readonly logger: ILoggerService,
    ) {}

    /**
     * Queues a welcome email to be dispatched asynchronously to a newly created admin.
     *
     * @param data The payload containing the admin's email, name, and plain text password.
     */
    async queueWelcomeAdminEmail(data: WelcomeAdminJobData): Promise<void> {
        try {
            await this.emailQueue.add(JOB_WELCOME_ADMIN, data, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            });
        } catch (error) {
            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.queueWelcomeAdminEmail.name,
                    error: error instanceof Error ? error : new Error(String(error)),
                    sub: data.email,
                }),
            );
            Sentry.captureException(error);
        }
    }
}
