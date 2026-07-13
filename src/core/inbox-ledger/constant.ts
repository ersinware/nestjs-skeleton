/**
 * @file constant.ts
 * @description Constants for the inbox dedup ledger.
 */

import { INBOX_RETENTION_BUFFER_MS, LEDGER_RETENTION_MS } from 'src/core/messaging';

/**
 * Retention window (ms) for inbox dedup markers before the prune cron removes them. Derived as the
 * shared ledger retention plus the inbox buffer, so a marker always outlives the outbox row whose
 * redelivery it suppresses — pruning a marker before its source event can no longer be redelivered
 * would reopen the duplicate-processing window.
 */
export const INBOX_LEDGER_RETENTION_MS = LEDGER_RETENTION_MS + INBOX_RETENTION_BUFFER_MS;
