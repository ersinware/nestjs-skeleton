/**
 * @file outbox-queue.ts
 * @description Internal queue identity for durable event delivery.
 */

/**
 * Shared queue consumed by application instances using pg-boss job claims.
 */
export const OUTBOX_QUEUE = 'domain-events';
