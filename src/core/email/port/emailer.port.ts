/**
 * @file emailer.port.ts
 * @description Outbound contract for sending transactional emails, with its payload shape.
 */

/**
 * Dependency injection token representing the {@link IEmailerPort} contract.
 */
export const TOKEN_EMAILER_PORT = Symbol('TOKEN_EMAILER_PORT');

/**
 * Data required to send one email.
 */
export type EmailPayload = {
    /** The target recipient email address. */
    to: string;

    /** The email subject. */
    subject: string;

    /** The HTML body of the email. */
    body: string;
};

/**
 * Contract for sending transactional emails, keeping the provider swappable behind the port.
 */
export interface IEmailerPort {
    /**
     * Sends an email.
     *
     * @param data The recipient, subject, and body of the email
     * @throws {Error} The raw provider error when the send fails.
     */
    sendEmail(data: EmailPayload): Promise<void>;
}
