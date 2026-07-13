import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OUTBOX_JOB_NAME, OUTBOX_QUEUE_NAME } from 'src/core/outbox/constant';
import type { IOutboxQueuePort } from 'src/core/outbox/port/outbox-queue.port';
import type { ClaimedOutboxEvent } from 'src/core/outbox/type';

@Injectable()
export class OutboxQueueAdapter implements IOutboxQueuePort {
    constructor(@InjectQueue(OUTBOX_QUEUE_NAME) private readonly outboxQueue: Queue) {}

    async queueEvents(events: ClaimedOutboxEvent[]) {
        if (events.length === 0) {
            return;
        }

        await this.outboxQueue.addBulk(
            events.map((event) => ({
                name: OUTBOX_JOB_NAME,
                data: event,
                // Only the per-job identity lives here; retry/backoff/retention come from the queue's
                // own `defaultJobOptions`. `jobId = event.id` makes re-enqueues idempotent.
                opts: {
                    jobId: event.id,
                },
            })),
        );
    }
}
