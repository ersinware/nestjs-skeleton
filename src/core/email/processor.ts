/**
 * @file processor.ts
 * @description BullMQ worker that delivers durable emails: it loads the ledger row, sends the email at
 * most once, and finalises the row — `SENT` on success, `DEAD` once retries are exhausted.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { ENV } from 'src/core/config';
import {
    EMAIL_JOB_NAME,
    EMAIL_QUEUE_NAME,
    EMAIL_RATE_LIMIT_DURATION_MS,
    EMAIL_RATE_LIMIT_MAX,
} from 'src/core/email/constant';
import { EmailStatus } from 'src/core/email/enum';
import {
    TOKEN_EMAIL_LEDGER_PORT,
    TOKEN_EMAILER_PORT,
    type IEmailerPort,
    type IEmailLedgerPort,
} from 'src/core/email/port';
import type { ClaimedEmail } from 'src/core/email/type';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';

/**
 * Background worker that consumes the email queue. A queue-level rate limiter shields the shared
 * Gmail quota from bursts; delivery idempotency comes from the email ledger.
 */
@Processor(EMAIL_QUEUE_NAME, {
    limiter: { max: EMAIL_RATE_LIMIT_MAX, duration: EMAIL_RATE_LIMIT_DURATION_MS },
})
export class EmailProcessor extends WorkerHost implements OnApplicationBootstrap {
    /**
     * Creates an instance of EmailProcessor.
     *
     * @param emailerPort - Service responsible for email dispatch.
     * @param emailLedgerPort - Durable email ledger persistence.
     * @param loggerPort - Structured logger.
     * @param exceptionTrackerPort - Exception reporter.
     * @param configService - Configuration client for the optional concurrency override.
     */
    constructor(
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        @Inject(TOKEN_EMAIL_LEDGER_PORT) private readonly emailLedgerPort: IEmailLedgerPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
        private readonly configService: ConfigService,
    ) {
        super();
    }

    /**
     * Applies the configured worker concurrency once the worker exists. Until this runs the worker
     * uses BullMQ's default concurrency of 1; the `EMAIL_WORKER_CONCURRENCY` env value is the single
     * source of truth for steady-state concurrency and is applied here.
     */
    onApplicationBootstrap() {
        this.worker.concurrency = this.configService.getOrThrow<number>(ENV.EMAIL_WORKER_CONCURRENCY);
    }

    /**
     * Delivers a single email: loads its durable row, skips it if it was already sent (the ledger
     * records a provider message id on success, so a redelivered job never sends twice), sends the
     * email, then marks the row `SENT`. A missing row means it was deleted or pruned — nothing to
     * deliver, so the job completes cleanly.
     *
     * @param job - The BullMQ job carrying the email id.
     * @throws {UnrecoverableError} if the job name is unknown, so it is dead-lettered without retries.
     * @throws Throws on any dispatch failure, so BullMQ retries the job.
     */
    async process(job: Job<ClaimedEmail, unknown, string>) {
        switch (job.name) {
            case EMAIL_JOB_NAME: {
                const email = await this.emailLedgerPort.getById(job.data.id);

                if (!email || email.status === EmailStatus.SENT) {
                    return;
                }

                await this.emailerPort.sendEmail({
                    to: email.to,
                    subject: email.subject,
                    body: email.body,
                });
                await this.emailLedgerPort.markSent(email.id);

                break;
            }
            default:
                // An unknown job name can never succeed on retry — dead-letter it immediately.
                throw new UnrecoverableError(`Unknown job name: ${job.name}`);
        }
    }

    /**
     * Once BullMQ stops retrying, records the failure and dead-letters the ledger row. Runs only on
     * the terminal outcome to avoid alert spam on transient failures. Termination happens two ways:
     * retries are exhausted, or the error is an `UnrecoverableError` (e.g. an unknown job name). In
     * the unrecoverable case BullMQ still leaves `attemptsMade` below `opts.attempts`, so it must be
     * detected explicitly — otherwise the dead-letter plus its log/Sentry report would be skipped and
     * the row would silently loop, being re-claimed every time its lease expired.
     *
     * @param job - The failed job.
     * @param error - The error thrown during processing.
     */
    @OnWorkerEvent('failed')
    async onFailed(job: Job<ClaimedEmail, unknown, string>, error: Error) {
        if (
            !(error instanceof UnrecoverableError || error.name === 'UnrecoverableError') &&
            job.attemptsMade < (job.opts.attempts ?? 0)
        ) {
            return;
        }

        this.loggerPort.error(
            new LogPayload({
                class: EmailProcessor.name,
                method: this.onFailed.name,
                error,
                queue: EMAIL_QUEUE_NAME,
                jobId: job.id,
            }),
        );
        this.exceptionTrackerPort.captureException(error);

        try {
            await this.emailLedgerPort.markDead(job.data.id);
        } catch (error) {
            // The terminal failure above already raised the Sentry alert. If persisting the DEAD
            // marker also fails, the row is re-claimed once its lease expires, so the dead-lettering
            // self-heals on a later pass. This is only a breadcrumb explaining *why* the email keeps
            // looping (the marker write failed) — no second alert.
            this.loggerPort.warn(
                new LogPayload({
                    class: EmailProcessor.name,
                    method: `${this.onFailed.name} -> ${this.emailLedgerPort.markDead.name}`,
                    error,
                    queue: EMAIL_QUEUE_NAME,
                    jobId: job.id,
                }),
            );
        }
    }
}
