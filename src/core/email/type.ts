/**
 * @file type.ts
 * @description Data shapes for sending email.
 */

/**
 * Represents the data payload structure required to send an email.
 */
export type EmailPayload = {
    /** The target recipient email address. */
    to: string;

    /** The email subject. */
    subject: string;

    /** The HTML body of the email. */
    body: string;
};
