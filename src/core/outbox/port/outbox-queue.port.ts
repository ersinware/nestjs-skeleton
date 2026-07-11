import type { PendingOutboxEvent } from 'src/core/outbox/type';

export const TOKEN_OUTBOX_QUEUE_PORT = Symbol('TOKEN_OUTBOX_QUEUE_PORT');

export interface IOutboxQueuePort {
    queueEvents(events: PendingOutboxEvent[]): Promise<void>;
}
