/**
 * @file email.type.ts
 * @description TypeScript type definitions for email queue job payloads.
 */

/**
 * Represents the data payload structure required for an email job.
 */
export type EmailPayload = {
    /**
     * The target recipient email address.
     */
    to: string;

    /**
     * The email subject.
     */
    subject: string;

    /**
     * The HTML body of the email.
     */
    body: string;
};
