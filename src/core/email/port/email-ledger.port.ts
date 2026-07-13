/**
 * @file email-ledger.port.ts
 * @description Outbound port for the email ledger — persisting, claiming, finalising and pruning
 * durable email intents. Implemented by a Drizzle adapter.
 */

import type { ClaimedEmail, EmailPayload, EmailRecord } from 'src/core/email/type';

/**
 * Dependency injection token representing the email ledger port.
 */
export const TOKEN_EMAIL_LEDGER_PORT = Symbol('TOKEN_EMAIL_LEDGER_PORT');

/**
 * Core interface for interacting with the email (durable email intent) persistence layer.
 */
export interface IEmailLedgerPort {
    /**
     * Persists an email intent as a `PENDING` email. A duplicate `dedupKey` is ignored, so re-enqueuing
     * the same logical email is idempotent.
     *
     * @param payload - Recipient, subject and body of the email.
     * @param dedupKey - Deterministic idempotency key for the intent.
     * @throws Throws if the database insertion fails.
     */
    saveEmail(payload: EmailPayload, dedupKey: string): Promise<void>;

    /**
     * Atomically claims a batch of dispatchable emails and returns them. A row is claimable when it is
     * `PENDING`, or `PROCESSING` with an expired lease — the latter is how orphaned emails recover.
     * Claimed rows move to `PROCESSING`, their attempt counter increments, and a fresh lease is applied.
     *
     * @param limit - Maximum number of emails to claim in this batch.
     * @param leaseMs - Lease duration in milliseconds applied to the claimed rows.
     * @returns The claimed emails.
     * @throws Throws if the database operation fails.
     */
    claimEmails(limit: number, leaseMs: number): Promise<ClaimedEmail[]>;

    /**
     * Loads the fields the email processor needs to decide whether to send and to build the message.
     *
     * @param id - Email identifier.
     * @returns The email record, or `null` if it no longer exists.
     * @throws Throws if the database query fails.
     */
    getById(id: string): Promise<EmailRecord | null>;

    /**
     * Marks an email as successfully sent (terminal success state).
     *
     * @param id - Email identifier.
     * @throws Throws if the database update fails.
     */
    markSent(id: string): Promise<void>;

    /**
     * Marks an email as dead-lettered after retries are exhausted (terminal failure state).
     *
     * @param id - Email identifier.
     * @throws Throws if the database update fails.
     */
    markDead(id: string): Promise<void>;

    /**
     * Deletes `SENT` rows last updated before the given cutoff, keeping the ledger bounded.
     *
     * @param olderThan - Cutoff timestamp; rows updated before this are removed.
     * @returns The number of rows removed.
     * @throws Throws if the database deletion fails.
     */
    pruneSent(olderThan: Date): Promise<number>;
}
