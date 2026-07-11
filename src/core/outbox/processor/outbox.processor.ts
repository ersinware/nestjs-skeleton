import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus/event-bus.port';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import { OUTBOX_QUEUE_NAME } from 'src/core/outbox/constant';
import { OutboxStatus } from 'src/core/outbox/enum';
import { TOKEN_OUTBOX_PORT, type IOutboxPort } from 'src/core/outbox/port/outbox.port';
import type { PendingOutboxEvent } from 'src/core/outbox/type';

@Processor(OUTBOX_QUEUE_NAME)
export class OutboxProcessor extends WorkerHost {
    constructor(
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
        @Inject(TOKEN_OUTBOX_PORT) private readonly outboxPort: IOutboxPort,
    ) {
        super();
    }

    async process(job: Job<PendingOutboxEvent>) {
        await this.eventBusPort.emitAsync(job.data.type, { id: job.data.aggregateId });
        await this.outboxPort.deleteEvents([job.data.id]);
    }

    @OnWorkerEvent('failed')
    async onFailed(job: Job<PendingOutboxEvent>, error: Error) {
        if (job.attemptsMade < (job.opts.attempts ?? 0)) {
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
            await this.outboxPort.updateStatus([job.data.id], OutboxStatus.FAILED);
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({
                    class: OutboxProcessor.name,
                    method: `${this.onFailed.name} -> ${this.outboxPort.updateStatus.name}`,
                    error,
                    queue: OUTBOX_QUEUE_NAME,
                    event: job.data,
                }),
            );
            this.exceptionTrackerPort.captureException(error);
        }
    }
}
