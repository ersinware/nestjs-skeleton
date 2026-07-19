/**
 * @file soft-deletable-aggregate-root.ts
 * @description Base class for Aggregate Roots whose deletion is a soft one. Owns the deletion timestamp and the "a soft-deleted aggregate is immutable" invariant.
 */

import { AggregateRoot } from 'src/shared/domain/aggregate-root/aggregate-root';
import { SystemException } from 'src/shared/exception';

/**
 * Base class for Aggregate Roots that are soft-deleted rather than removed.
 *
 * Owns `deletedAt` the way `AggregateRoot` owns `id`: subclasses keep it out of their own props, so
 * the timestamp has exactly one home and a mutator cannot leave a stale copy behind.
 *
 * Opt-in on purpose: soft deletion is a domain decision, not a property of every aggregate, so it
 * sits here instead of on `AggregateRoot` — an aggregate that is genuinely deleted extends the plain
 * base and never learns about `deletedAt`.
 */
export abstract class SoftDeletableAggregateRoot extends AggregateRoot {
    private _deletedAt: Date | null;

    /**
     * Initializes the soft-deletable base state.
     *
     * @param id The unique identifier
     * @param deletedAt The persisted deletion timestamp, or null while the aggregate is live
     */
    protected constructor(id: string, deletedAt: Date | null) {
        super(id);
        this._deletedAt = deletedAt;
    }

    /**
     * Gets the moment the aggregate was soft-deleted, or null while it is still live.
     */
    get deletedAt(): Date | null {
        return this._deletedAt;
    }

    /**
     * Stamps the deletion timestamp. Subclasses call this from their own `markAsDeleted`, which
     * stays theirs to own: the surrounding state changes and the emitted event differ per aggregate.
     *
     * @param deletedAt The moment the aggregate was deleted
     */
    protected setDeletedAt(deletedAt: Date) {
        this._deletedAt = deletedAt;
    }

    /**
     * Guards the "a soft-deleted aggregate is immutable" invariant. Writers load only non-deleted
     * rows, so reaching this guard means a broken code path handed a deleted aggregate to a
     * mutator — a system fault surfaced as 500 + Sentry, never a client error.
     *
     * @param method The mutating method that was called, recorded as the exception origin
     * @throws {SystemException} When the aggregate has been soft-deleted
     */
    protected assertNotDeleted(method: string) {
        if (this._deletedAt) {
            throw new SystemException('Mutation attempted on a soft-deleted aggregate.', {
                context: { class: this.constructor.name, method, id: this.id },
            });
        }
    }
}
