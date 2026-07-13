import type { ClaimedOutboxEvent } from 'src/core/outbox/type';

export const TOKEN_OUTBOX_QUEUE_PORT = Symbol('TOKEN_OUTBOX_QUEUE_PORT');

export interface IOutboxQueuePort {
    /**
     * Enqueues claimed events for asynchronous dispatch.
     *
     * @param events - The claimed events to enqueue.
     * @throws Throws if the enqueue operation fails.
     */
    queueEvents(events: ClaimedOutboxEvent[]): Promise<void>;
}
