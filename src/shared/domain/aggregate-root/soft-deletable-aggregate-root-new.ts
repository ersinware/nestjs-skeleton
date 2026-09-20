/**
 * @file soft-deletable-aggregate-root-new.ts
 * @description Defines soft-deletion state for job-producing aggregate roots.
 */

import { AggregateRootNew } from 'src/shared/domain/aggregate-root/aggregate-root-new';
import { SystemException } from 'src/shared/exception';

/**
 * Base for job-producing aggregates that become immutable after soft deletion.
 */
export abstract class SoftDeletableAggregateRootNew extends AggregateRootNew {
    /**
     * Persisted deletion timestamp, or null while the aggregate is active.
     */
    private deletedAtValue: Date | null;

    /**
     * Initializes the aggregate with its deletion state.
     *
     * @param id The unique identifier
     * @param version The persisted version the state was loaded at; 0 for a new aggregate
     * @param deletedAt The persisted deletion timestamp, or null while the aggregate is live
     */
    protected constructor(id: string, version: number, deletedAt: Date | null) {
        super(id, version);
        this.deletedAtValue = deletedAt;
    }

    /**
     * Records the deletion timestamp.
     *
     * @param deletedAt The moment the aggregate was deleted
     */
    protected setDeletedAt(deletedAt: Date) {
        this.deletedAtValue = deletedAt;
    }

    /**
     * Guards the invariant that a soft-deleted aggregate is immutable.
     *
     * @param method The mutating method that was called
     * @throws {SystemException} When the aggregate has been soft-deleted
     */
    protected assertNotDeleted(method: string) {
        if (this.deletedAtValue) {
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
        return this.deletedAtValue;
    }
}
