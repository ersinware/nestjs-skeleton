/**
 * @file type.ts
 * @description Data shapes for the email pipeline: the intake payload and the ledger read shapes used
 * by the relay and the email processor.
 */

import type { EmailStatus } from 'src/core/email/enum';

/**
 * Represents the data payload structure required for an email job.
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
 * A claimed email handed from the relay to the queue — only the identity is needed to enqueue it; the
 * processor re-reads the full row before sending.
 */
export type ClaimedEmail = {
    id: string;
};

/**
 * The full email row the email processor needs to decide whether to send and to build the outgoing
 * message. `status` is carried verbatim; the processor derives the "already sent" short-circuit from it.
 */
export type EmailRecord = {
    id: string;
    to: string;
    subject: string;
    body: string;
    status: EmailStatus;
};
