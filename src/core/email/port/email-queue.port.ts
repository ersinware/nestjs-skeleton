/**
 * @file email-queue.port.ts
 * @description Outbound port that pushes claimed emails onto the BullMQ email queue for delivery.
 * Implemented by a BullMQ adapter.
 */

import type { ClaimedEmail } from 'src/core/email/type';

/**
 * Dependency injection token representing the email queue port.
 */
export const TOKEN_EMAIL_QUEUE_PORT = Symbol('TOKEN_EMAIL_QUEUE_PORT');

/**
 * Queue contract for handing claimed emails to the async delivery mechanism.
 */
export interface IEmailQueuePort {
    /**
     * Enqueues claimed emails for asynchronous delivery. Each job is keyed by the email id so
     * re-dispatching the same claimed row is idempotent.
     *
     * @param emails - The claimed emails to enqueue.
     * @throws Throws if the enqueue operation fails.
     */
    queueEmails(emails: ClaimedEmail[]): Promise<void>;
}
