/**
 * @file constant.ts
 * @description Dependency injection tokens and constants for the email module.
 */

import { exponentialBackoffCeilingMs, LEDGER_RETENTION_MS, RELAY_LEASE_GRACE_MS } from 'src/core/messaging';

/**
 * Name of the BullMQ queue handling email operations.
 */
export const EMAIL_QUEUE_NAME = 'email';

/**
 * BullMQ job name for a single send-email job.
 */
export const EMAIL_JOB_NAME = 'send-email';

/**
 * Maximum number of emails claimed and dispatched per relay drain iteration.
 */
export const EMAIL_BATCH_SIZE = 50;

/**
 * Total execution attempts for an email job before it is dead-lettered. Single source of truth: the
 * queue's `defaultJobOptions.attempts` reads this, and the lease is derived from it.
 */
export const EMAIL_QUEUE_ATTEMPTS = 6;

/**
 * Base delay (ms) for the email queue's exponential backoff. Email jobs hit an external, rate-limited
 * provider (Gmail API) whose recovery windows are measured in minutes, so the base backoff is longer
 * than internal-infra queues to avoid burning all retries inside a single 429/quota window.
 */
export const EMAIL_QUEUE_BACKOFF_MS = 15_000;

/**
 * Lease duration (ms) applied when an email is claimed. DERIVED from the queue's own retry ceiling
 * plus a grace window, so it can never silently fall below the time a job may still be legitimately
 * retrying — bumping {@link EMAIL_QUEUE_ATTEMPTS} or {@link EMAIL_QUEUE_BACKOFF_MS} grows the lease
 * automatically. If an email is not finalised (SENT/DEAD) before the lease expires, the relay
 * re-claims it — the self-healing recovery mechanism for orphaned emails (lost BullMQ jobs, crashed
 * workers). The {@link RELAY_LEASE_GRACE_MS} grace on top of the retry ceiling absorbs per-attempt
 * execution time and clock skew.
 */
export const EMAIL_LEASE_MS =
    exponentialBackoffCeilingMs(EMAIL_QUEUE_ATTEMPTS, EMAIL_QUEUE_BACKOFF_MS) + RELAY_LEASE_GRACE_MS;

/**
 * Retention window (ms) for SENT email rows before the prune cron removes them. Uses the shared ledger
 * retention so audit-trail depth stays defined in exactly one place across reliable-messaging modules.
 */
export const EMAIL_SENT_RETENTION_MS = LEDGER_RETENTION_MS;

/**
 * Burst rate limit for the email worker: at most `EMAIL_RATE_LIMIT_MAX` sends per
 * `EMAIL_RATE_LIMIT_DURATION_MS`. This protects the shared Gmail per-user quota from spikes; it is a
 * burst guard, not the provider's daily cap.
 */
export const EMAIL_RATE_LIMIT_MAX = 30;

/**
 * Time window (ms) over which `EMAIL_RATE_LIMIT_MAX` is enforced.
 */
export const EMAIL_RATE_LIMIT_DURATION_MS = 60 * 1000;
