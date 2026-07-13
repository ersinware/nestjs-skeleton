/**
 * @file port.ts
 * @description Consumer-side idempotency port. Guards handlers so the same event is never applied
 * twice, turning at-least-once delivery into effectively-once effects (the "inbox" pattern).
 */

/**
 * Dependency injection token representing the inbox ledger port.
 */
export const TOKEN_INBOX_LEDGER_PORT = Symbol('TOKEN_INBOX_LEDGER_PORT');

/**
 * Contract for consumer-side idempotency.
 */
export interface IInboxLedgerPort {
    /**
     * Runs `work` at most once per `(consumer, eventId)`. The dedup marker and `work` commit in the
     * same database transaction, so a transactional (database-backed) side effect and its marker are
     * atomic — if `work` throws, the marker is rolled back and a later redelivery retries cleanly.
     *
     * @param consumer - Stable identifier of the consumer (e.g. the listener class name).
     * @param eventId - Unique event id used as the idempotency key.
     * @param work - The side effect to run exactly once.
     * @returns `true` if `work` ran, `false` if the event was already processed.
     * @throws Throws if the database operation or `work` fails.
     */
    runOnce(consumer: string, eventId: string, work: () => Promise<void>): Promise<boolean>;

    /**
     * Reports whether `(consumer, eventId)` has already been processed. Use together with
     * `markProcessed` for external, non-transactional effects that cannot join a database transaction.
     *
     * @param consumer - Stable identifier of the consumer.
     * @param eventId - Unique event id used as the idempotency key.
     * @returns `true` if already processed.
     * @throws Throws if the database query fails.
     */
    isProcessed(consumer: string, eventId: string): Promise<boolean>;

    /**
     * Records `(consumer, eventId)` as processed. Idempotent: marking twice is a no-op.
     *
     * @param consumer - Stable identifier of the consumer.
     * @param eventId - Unique event id used as the idempotency key.
     * @throws Throws if the database write fails.
     */
    markProcessed(consumer: string, eventId: string): Promise<void>;

    /**
     * Deletes dedup markers first processed before the given cutoff, bounding the ledger's growth. The
     * cutoff MUST be old enough that the underlying events can no longer be redelivered, otherwise a
     * later duplicate would be processed again.
     *
     * @param olderThan - Cutoff timestamp; markers processed before this are removed.
     * @returns The number of markers removed.
     * @throws Throws if the database deletion fails.
     */
    prune(olderThan: Date): Promise<number>;
}
