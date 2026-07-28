/**
 * @file emailer.port.ts
 * @description Contract for the MailerService used to send emails.
 */
import type { EmailPayload } from 'src/core/email/email-payload.type';

/**
 * Dependency injection token representing the mailer service contract interface.
 */
export const TOKEN_EMAILER_PORT = Symbol('TOKEN_EMAILER_PORT');

/**
 * Contract for sending transactional emails through the configured provider.
 */
export interface IEmailerPort {
    /**
     * Sends an email.
     *
     * @param data The email job data containing recipient, subject, and body
     * @throws {Error} The raw provider error when the send fails.
     */
    sendEmail(data: EmailPayload): Promise<void>;
}
