/**
 * @file relay.ts
 * @description Template-method base for durable-ledger relay engines. Owns the single-flight drain
 * loop and error handling shared by every relay (outbox events, emails, …); subclasses supply
 * only the ledger claim and the downstream dispatch. Keeping the coordination logic here means the
 * at-least-once, lease-based draining behaviour lives in exactly one place.
 */

import { LogPayload } from 'src/core/observability';
import type { ILoggerPort } from 'src/core/observability/logger';

/**
 * Coordinates draining of a durable message ledger for a single process. Claiming is expected to use
 * `FOR UPDATE SKIP LOCKED`, so many instances can run this concurrently without dispatching the same
 * item twice. Subclasses only decide *what* to claim and *where* to dispatch it.
 *
 * @typeParam T - The claimed item shape (e.g. a claimed outbox event or email).
 */
export abstract class AbstractMessageRelayService<T> {
    private isDraining = false;
    private rerunRequested = false;

    /**
     * Maximum number of items to claim per batch. A full batch signals there may be more work, so the
     * drain loop keeps going until a short batch is returned.
     */
    protected abstract readonly batchSize: number;

    /**
     * Lease duration in milliseconds applied to claimed rows, after which an unfinished item becomes
     * claimable again by any instance.
     */
    protected abstract readonly leaseMs: number;

    /**
     * Creates an instance of the relay base.
     *
     * @param loggerPort - Structured logger.
     */
    protected constructor(private readonly loggerPort: ILoggerPort) {}

    /**
     * Atomically claims a batch of dispatchable items from the durable ledger, applying a fresh lease.
     * Implemented per relay against its own ledger.
     *
     * @param batchSize - Maximum number of items to claim.
     * @param leaseMs - Lease duration in milliseconds to apply to the claimed rows.
     * @returns The claimed items.
     */
    protected abstract claim(batchSize: number, leaseMs: number): Promise<T[]>;

    /**
     * Hands a claimed batch to its downstream transport (e.g. a BullMQ queue). Implemented per relay.
     *
     * @param items - The claimed items to dispatch.
     */
    protected abstract dispatch(items: T[]): Promise<void>;

    /**
     * Requests a relay drain. Single-flight per process: while a drain is running, further requests do
     * not start a second drain but schedule exactly one more pass once the current one finishes. This
     * closes the race where a nudge arrives just as a drain is winding down and would otherwise be
     * dropped until the fallback cron.
     *
     * Never rejects: every drain failure is caught internally and logged, and the `finally` always
     * clears the single-flight flag. This is a load-bearing contract — callers fire it as
     * `void requestDrain()` (from a NOTIFY nudge or a cron tick) and rely on it never surfacing an
     * unhandled rejection, so a wrapping try/catch at the call site would be dead code.
     */
    async requestDrain() {
        this.rerunRequested = true;

        if (this.isDraining) {
            return;
        }

        this.isDraining = true;

        try {
            while (this.rerunRequested) {
                this.rerunRequested = false;
                await this.drain();
            }
        } catch (error) {
            // A drain failure is self-healing: claimed rows keep their lease and become claimable
            // again, and the fallback cron plus the next NOTIFY re-trigger the drain. So this is a
            // breadcrumb (warn), not a Sentry alert — only a *persistent* delivery stall is
            // actionable, and that is surfaced by outbox-backlog metrics, not per-exception noise.
            this.loggerPort.warn(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.requestDrain.name,
                    error,
                }),
            );
        } finally {
            this.isDraining = false;
        }
    }

    /**
     * Drains the ledger in batches until no more claimable items remain. Claimed rows carry a lease,
     * so if a batch fails to dispatch the rows simply become claimable again on a later pass rather
     * than being lost.
     */
    private async drain() {
        let claimedCount = 0;

        do {
            const items = await this.claim(this.batchSize, this.leaseMs);
            claimedCount = items.length;

            if (claimedCount > 0) {
                await this.dispatch(items);
            }
        } while (claimedCount === this.batchSize);
    }
}
