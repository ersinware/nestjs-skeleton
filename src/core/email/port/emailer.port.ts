/**
 * @file emailer.port.ts
 * @description Contract for the MailerService used to send emails.
 */
import type { EmailPayload } from 'src/core/email/type';

/**
 * Dependency injection token representing the mailer service contract interface.
 */
export const TOKEN_EMAILER_PORT = Symbol('TOKEN_EMAILER_PORT');

export interface IEmailerPort {
    /**
     * Sends an email.
     *
     * @param data The email job data containing recipient, subject, and body
     */
    sendEmail(data: EmailPayload): Promise<void>;
}
