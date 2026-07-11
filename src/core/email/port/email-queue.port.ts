/**
 * @file email.port.ts
 * @description Contract for the EmailAdapter.
 */
import type { EmailPayload } from 'src/core/email/type';

/**
 * Dependency injection token representing the email service contract interface.
 */
export const TOKEN_EMAIL_QUEUE_PORT = Symbol('TOKEN_EMAIL_QUEUE_PORT');

/**
 * Interface representing the operations supported by the EmailAdapter.
 */
export interface IEmailQueuePort {
    /**
     * Queues an email to be dispatched asynchronously.
     *
     * @param data The email job data containing recipient, subject, and body
     */
    queueEmail(data: EmailPayload, jobId: string): Promise<void>;
}
