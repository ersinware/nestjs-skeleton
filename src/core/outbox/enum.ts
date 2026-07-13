/**
 * @file enum.ts
 * @description Lifecycle states of an outbox row within the reliable-messaging state machine.
 */

/**
 * The lifecycle status of an outbox event.
 *
 * Transitions:
 * - `PENDING → PROCESSING` when a relay claims the event (a lease is applied).
 * - `PROCESSING → PUBLISHED` when the consumer dispatches it successfully (terminal success).
 * - `PROCESSING → PENDING` implicitly, once the lease expires — an unfinished event becomes
 *   claimable again, which is how orphaned events self-heal.
 * - `PROCESSING → DEAD` once BullMQ exhausts all retries (terminal failure / dead-letter).
 */
export enum OutboxStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    PUBLISHED = 'PUBLISHED',
    DEAD = 'DEAD',
}
