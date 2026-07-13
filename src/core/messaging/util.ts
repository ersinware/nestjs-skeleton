/**
 * @file util.ts
 * @description Computes the worst-case total wait across a BullMQ exponential-backoff retry sequence.
 * Used to derive relay lease durations that always outlast the queue's own retries, so a job that is
 * still legitimately retrying is never re-claimed as an orphan.
 */

/**
 * Total worst-case delay (ms) BullMQ waits across every retry of an exponential-backoff job. BullMQ
 * waits `baseDelayMs * 2^(k-1)` before the k-th retry, and across `attempts` executions there are
 * `attempts - 1` retries, so the waits sum to `baseDelayMs * (2^(attempts - 1) - 1)`. A relay lease
 * must exceed this value; deriving the lease from it keeps the invariant unbreakable when the queue's
 * retry policy changes.
 *
 * @param attempts - Total execution attempts configured on the queue (`defaultJobOptions.attempts`).
 * @param baseDelayMs - Base backoff delay configured on the queue (`defaultJobOptions.backoff.delay`).
 * @returns The summed worst-case backoff wait in milliseconds.
 */
export function exponentialBackoffCeilingMs(attempts: number, baseDelayMs: number): number {
    return baseDelayMs * (2 ** (attempts - 1) - 1);
}
