import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OUTBOX_QUEUE_NAME } from 'src/core/outbox/constant';
import type { IOutboxQueuePort } from 'src/core/outbox/port/outbox-queue.port';
import type { PendingOutboxEvent } from 'src/core/outbox/type';

@Injectable()
export class OutboxQueueAdapter implements IOutboxQueuePort {
    constructor(@InjectQueue(OUTBOX_QUEUE_NAME) private readonly outboxQueue: Queue) {}

    async queueEvents(events: PendingOutboxEvent[]) {
        if (events.length === 0) {
            throw new Error('The events array must not be empty.');
        }

        await this.outboxQueue.addBulk(
            events.map((event) => ({
                name: 'publish-event',
                data: event,
                opts: {
                    jobId: event.id,
                    attempts: 5,
                    backoff: { type: 'exponential', delay: 1000 },
                    removeOnComplete: {
                        age: 24 * 60 * 60,
                        count: 1000,
                    },
                    removeOnFail: false,
                },
            })),
        );
    }
}
