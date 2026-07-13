/**
 * @file constant.ts
 * @description Shared constants for deriving relay lease durations across reliable-messaging modules.
 */

/**
 * Grace window (ms) added on top of a queue's exponential-backoff retry ceiling when deriving a relay
 * lease. The retry ceiling only accounts for the time spent *waiting* between attempts; this grace
 * absorbs per-attempt execution time and clock skew between distributed workers, so a job that is
 * still legitimately retrying is never re-claimed as an orphan. Shared by every relay module (outbox,
 * email) so the tolerance stays defined in exactly one place.
 */
export const RELAY_LEASE_GRACE_MS = 2 * 60 * 1000;

/**
 * Base retention window (ms) for a durable ledger's terminal rows before a prune cron removes them.
 * Shared by every reliable-messaging ledger so the audit-trail depth is defined in exactly one place;
 * modules that need a different lifetime (e.g. the consumer-side inbox) derive from this value rather
 * than restating it.
 */
export const LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Extra retention (ms) the consumer-side inbox keeps ON TOP of {@link LEDGER_RETENTION_MS}. A duplicate
 * event can be redelivered for as long as its source outbox row still exists, so the inbox dedup marker
 * that suppresses it MUST outlive that row. Deriving the inbox lifetime as `LEDGER_RETENTION_MS +
 * INBOX_RETENTION_BUFFER_MS` keeps the "inbox outlives outbox" invariant true by construction, and the
 * buffer absorbs prune-timing skew between the two daily crons plus any pathological pruning delay.
 */
export const INBOX_RETENTION_BUFFER_MS = 3 * 24 * 60 * 60 * 1000;
