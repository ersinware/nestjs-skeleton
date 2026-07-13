/**
 * @file enum.ts
 * @description Lifecycle states of an email row within the durable email-delivery state machine.
 */

/**
 * The lifecycle status of a durable email (email intent).
 *
 * Transitions:
 * - `PENDING → PROCESSING` when the relay claims the email (a lease is applied).
 * - `PROCESSING → SENT` when the emailer dispatches it successfully (terminal success).
 * - `PROCESSING → PENDING` implicitly, once the lease expires — an unfinished email becomes claimable
 *   again, which is how orphaned emails self-heal.
 * - `PROCESSING → DEAD` once BullMQ exhausts all retries (terminal failure / dead-letter).
 */
export enum EmailStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    SENT = 'SENT',
    DEAD = 'DEAD',
}
