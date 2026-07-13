/**
 * @file constant.ts
 * @description Constants and configuration for the Outbox reliable-messaging module.
 */

import { exponentialBackoffCeilingMs, LEDGER_RETENTION_MS, RELAY_LEASE_GRACE_MS } from 'src/core/messaging';

/**
 * Name of the BullMQ queue used for processing outbox events.
 */
export const OUTBOX_QUEUE_NAME = 'outbox';

/**
 * BullMQ job name for a single published outbox event.
 */
export const OUTBOX_JOB_NAME = 'publish-event';

/**
 * Maximum number of events claimed and dispatched per relay drain iteration.
 */
export const OUTBOX_BATCH_SIZE = 50;

/**
 * Total execution attempts for an outbox job before it is dead-lettered. Single source of truth: the
 * queue's `defaultJobOptions.attempts` reads this, and the lease is derived from it.
 */
export const OUTBOX_QUEUE_ATTEMPTS = 5;

/**
 * Base delay (ms) for the outbox queue's exponential backoff. Outbox jobs only touch internal infra
 * (DB, Redis, event bus), which recovers within seconds, so a tight base backoff drains transient
 * failures fast.
 */
export const OUTBOX_QUEUE_BACKOFF_MS = 2_000;

/**
 * Lease duration (ms) applied when an event is claimed. DERIVED from the queue's own retry ceiling
 * plus a grace window, so it can never silently fall below the time a job may still be legitimately
 * retrying — bumping {@link OUTBOX_QUEUE_ATTEMPTS} or {@link OUTBOX_QUEUE_BACKOFF_MS} grows the lease
 * automatically. If a claimed event is not finalised (PUBLISHED/DEAD) before the lease expires, the
 * relay re-claims it — the self-healing recovery mechanism for orphaned events. The
 * {@link RELAY_LEASE_GRACE_MS} grace on top of the retry ceiling absorbs per-attempt execution time
 * and clock skew.
 */
export const OUTBOX_LEASE_MS =
    exponentialBackoffCeilingMs(OUTBOX_QUEUE_ATTEMPTS, OUTBOX_QUEUE_BACKOFF_MS) + RELAY_LEASE_GRACE_MS;

/**
 * Retention window (ms) for PUBLISHED rows before the prune cron removes them. Uses the shared ledger
 * retention so the consumer-side inbox can derive a strictly longer lifetime from the same base.
 */
export const OUTBOX_PUBLISHED_RETENTION_MS = LEDGER_RETENTION_MS;
