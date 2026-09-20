/**
 * @file soft-deletable-aggregate-root.ts
 * @description Defines soft-deletion state for job-producing aggregate roots.
 */

import { AggregateRoot } from 'src/shared/domain/aggregate-root/aggregate-root';
import { SystemException } from 'src/shared/exception';

/**
 * Base for job-producing aggregates that become immutable after soft deletion.
 */
export abstract class SoftDeletableAggregateRoot extends AggregateRoot {
    /**
     * Persisted deletion timestamp, or null while the aggregate is active.
     */
    private _deletedAt: Date | null;

    /**
     * Initializes the aggregate with its deletion state.
     *
     * @param id The unique identifier
     * @param version The persisted version the state was loaded at; 0 for a new aggregate
     * @param deletedAt The persisted deletion timestamp, or null while the aggregate is live
     */
    protected constructor(id: string, version: number, deletedAt: Date | null) {
        super(id, version);
        this._deletedAt = deletedAt;
    }

    /**
     * Records the deletion timestamp.
     *
     * @param deletedAt The moment the aggregate was deleted
     */
    protected setDeletedAt(deletedAt: Date) {
        this._deletedAt = deletedAt;
    }

    /**
     * Guards the invariant that a soft-deleted aggregate is immutable.
     *
     * @param method The mutating method that was called
     * @throws {SystemException} When the aggregate has been soft-deleted
     */
    protected assertNotDeleted(method: string) {
        if (this._deletedAt) {
            throw new SystemException('Mutation attempted on a soft-deleted aggregate.', {
                context: { class: this.constructor.name, method, id: this.id },
            });
        }
    }

    /**
     * Returns the deletion timestamp, or null while the aggregate is active.
     *
     * @returns Persisted deletion timestamp or null
     */
    get deletedAt(): Date | null {
        return this._deletedAt;
    }
}
