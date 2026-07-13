/**
 * @file processor.ts
 * @description BullMQ worker that dispatches outbox events into the in-process event bus and
 * finalises their ledger status — `PUBLISHED` on success, `DEAD` once retries are exhausted.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { ENV } from 'src/core/config';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus/event-bus.port';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import { OUTBOX_QUEUE_NAME } from 'src/core/outbox/constant';
import { NonRetriableEventError } from 'src/core/outbox/exception';
import { TOKEN_OUTBOX_LEDGER_PORT, type IOutboxLedgerPort } from 'src/core/outbox/port/outbox-ledger.port';
import type { ClaimedOutboxEvent } from 'src/core/outbox/type';

/**
 * Consumes the outbox queue: dispatches each event to the application event bus, then records its
 * terminal status on the ledger.
 */
@Processor(OUTBOX_QUEUE_NAME)
export class OutboxProcessor extends WorkerHost implements OnApplicationBootstrap {
    /**
     * Creates an instance of OutboxProcessor.
     *
     * @param loggerPort - Structured logger.
     * @param exceptionTrackerPort - Exception reporter.
     * @param eventBusPort - In-process event bus used to fan out domain events.
     * @param outboxLedgerPort - Outbox ledger persistence.
     * @param configService - Configuration client for the optional concurrency override.
     */
    constructor(
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
        @Inject(TOKEN_OUTBOX_LEDGER_PORT) private readonly outboxLedgerPort: IOutboxLedgerPort,
        private readonly configService: ConfigService,
    ) {
        super();
    }

    /**
     * Applies the configured worker concurrency once the worker exists. Until this runs the worker
     * uses BullMQ's default concurrency of 1; the `OUTBOX_WORKER_CONCURRENCY` env value is the single
     * source of truth for steady-state concurrency and is applied here.
     */
    onApplicationBootstrap() {
        this.worker.concurrency = this.configService.getOrThrow<number>(ENV.OUTBOX_WORKER_CONCURRENCY);
    }

    /**
     * Dispatches a single outbox event to the event bus, then marks it `PUBLISHED`. A retriable error
     * leaves the row in `PROCESSING` (protected by its lease) so BullMQ retries drive it forward, and
     * an expired lease lets the relay reclaim it if the worker dies. A `NonRetriableEventError` from a
     * consumer is a poison message: it is converted to BullMQ's `UnrecoverableError` so retries are
     * skipped and the event is dead-lettered (`DEAD`) at once.
     *
     * @param job - The BullMQ job carrying the outbox event.
     * @throws {UnrecoverableError} if a consumer reports the event as permanently non-retriable.
     * @throws Throws on any other dispatch failure, so BullMQ retries the job.
     */
    async process(job: Job<ClaimedOutboxEvent>) {
        try {
            // `aggregateId` is the re-fetch key; `eventId` is the unique outbox id used by consumers
            // as their inbox idempotency key.
            await this.eventBusPort.emitAsync(job.data.type, {
                aggregateId: job.data.aggregateId,
                eventId: job.data.id,
            });
        } catch (error) {
            if (error instanceof NonRetriableEventError) {
                throw new UnrecoverableError(error.message);
            }

            throw error;
        }

        await this.outboxLedgerPort.markPublished([job.data.id]);
    }

    /**
     * Once BullMQ stops retrying, records the failure and dead-letters the ledger row. Runs only on
     * the terminal outcome to avoid alert spam on transient failures. Termination happens two ways:
     * retries are exhausted, or the error is an `UnrecoverableError` (our poison-message signal). In
     * the unrecoverable case BullMQ still leaves `attemptsMade` below `opts.attempts`, so it must be
     * detected explicitly — otherwise the dead-letter plus its log/Sentry report would be skipped and
     * the row would silently loop, being re-claimed every time its lease expired.
     *
     * @param job - The failed job.
     * @param error - The error thrown during processing.
     */
    @OnWorkerEvent('failed')
    async onFailed(job: Job<ClaimedOutboxEvent>, error: Error) {
        if (
            !(error instanceof UnrecoverableError || error.name === 'UnrecoverableError') &&
            job.attemptsMade < (job.opts.attempts ?? 0)
        ) {
            return;
        }

        this.loggerPort.error(
            new LogPayload({
                class: OutboxProcessor.name,
                method: this.onFailed.name,
                error,
                queue: OUTBOX_QUEUE_NAME,
                event: job.data,
            }),
        );
        this.exceptionTrackerPort.captureException(error);

        try {
            await this.outboxLedgerPort.markDead([job.data.id]);
        } catch (error) {
            // The terminal failure above already raised the Sentry alert. If persisting the DEAD
            // marker also fails, the row stays PROCESSING and is re-claimed once its lease expires,
            // so the dead-lettering self-heals on a later pass. This is only a breadcrumb explaining
            // *why* the event keeps looping (the marker write failed) — no second alert.
            this.loggerPort.warn(
                new LogPayload({
                    class: OutboxProcessor.name,
                    method: `${this.onFailed.name} -> ${this.outboxLedgerPort.markDead.name}`,
                    error,
                    queue: OUTBOX_QUEUE_NAME,
                    event: job.data,
                }),
            );
        }
    }
}
