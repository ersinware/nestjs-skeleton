/**
 * @file mailer.service.interface.ts
 * @description Contract for the MailerService used to send emails.
 */

export interface IMailerService {
    /**
     * Sends an HTML email.
     *
     * @param to Recipient email address.
     * @param subject Email subject line.
     * @param body HTML body content.
     */
    sendEmail(to: string, subject: string, body: string): Promise<void>;
}
