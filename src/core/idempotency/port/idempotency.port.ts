/**
 * @file idempotency.port.ts
 * @description Atomic request claims and minimal success replay metadata for PostgreSQL mutations.
 */

/**
 * Dependency injection token for {@link IIdempotencyPort}.
 */
export const TOKEN_IDEMPOTENCY_PORT = Symbol();

/**
 * Validated logical request identity; callers own semantic canonicalization.
 */
export type IdempotencyRequest = {
    /**
     * Globally unique client-generated UUID v4, preserved as supplied at the HTTP edge.
     */
    readonly key: string;

    /**
     * JSON-encoded fixed-order vector of method, versioned route template, and normalized semantic fields.
     * Never persisted or included in diagnostic context.
     */
    readonly canonicalValue: string;
};

/**
 * Only the stable identity needed to reconstruct success; never a response snapshot.
 */
export type IdempotencyResult = {
    /**
     * Original operation identifier, or null for success responses requiring no metadata.
     */
    readonly replayResultId: string | null;
};

/**
 * Owns the transaction for a request claim, business mutation, audit, jobs, and replay metadata.
 */
export interface IIdempotencyPort {
    /**
     * Checks retained success before preparing proofs, external reads, or password work outside
     * the transaction. Preparation must have no business writes or effects. The final claim
     * rechecks concurrent success even if preparation fails; only its winner invokes work.
     * Prepared aggregate snapshots retain optimistic concurrency protection when saved.
     * Preparation and work failures propagate unless retained success wins the final claim.
     *
     * @param idempotencyRequest Validated key and canonical semantic input
     * @param prepare Read-only preparation outside the commit boundary
     * @param work Sequential DB-only mutation using the prepared facts
     * @returns Original success metadata after commit
     * @throws {ResourceConflictException} When the key is already bound to another fingerprint
     * @throws {SystemException} When a transaction is already active or a claimed operation is missing
     * @throws {DependencyUnavailableException} When required persistence or preparation dependencies are unavailable
     */
    executePrepared<T>(
        idempotencyRequest: IdempotencyRequest,
        prepare: () => Promise<T>,
        work: (prepared: T) => Promise<IdempotencyResult>,
    ): Promise<IdempotencyResult>;

    /**
     * Commits new work once or returns retained success metadata without invoking work.
     * Same-key concurrent calls wait for transaction settlement; rollback leaves the key claimable.
     * Callbacks must await sequential DB-only work using the primary transaction proxy, without
     * opening another transaction or dispatching pipelines. Authentication, authorization, and
     * rate limiting remain the caller's responsibility on every request, including replay.
     * No automatic retry occurs after an ambiguous database outcome; clients reuse the same key.
     *
     * @param idempotencyRequest Validated key and canonical semantic input
     * @param work Database-only mutation returning the minimum replay metadata
     * @returns Original success metadata after commit
     * @throws {ResourceConflictException} When the key is already bound to another fingerprint
     * @throws {SystemException} When a transaction is already active or a claimed operation is missing
     * @throws {DependencyUnavailableException} When required database persistence is unavailable
     */
    execute(idempotencyRequest: IdempotencyRequest, work: () => Promise<IdempotencyResult>): Promise<IdempotencyResult>;
}
