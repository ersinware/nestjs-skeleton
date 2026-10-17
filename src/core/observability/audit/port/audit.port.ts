/**
 * @file audit.port.ts
 * @description Contract for writing audit records, kept separate from the logging contract on purpose.
 */

/**
 * Dependency injection token representing the {@link IAuditPort} contract.
 */
export const TOKEN_AUDIT_PORT = Symbol();

/**
 * What an action changed, beyond what its ids say. Callers must restrict values to identifiers
 * and enum members; this string-based type does not enforce content restrictions.
 */
export type AuditDetail = Readonly<Record<string, string | readonly string[]>>;

/**
 * What the caller supplies — the meaning of the action and nothing else. IP, user agent and trace
 * are the adapter's to fill from the ambient context. No success/failure field: each
 * action states its own outcome.
 */
export type AuditRecordInput = {
    /**
     * What happened, outcome included; the record's only required fact.
     */
    readonly action: string;

    /**
     * Why a refusal happened; meaningless on an action that cannot fail.
     */
    readonly reason?: string;

    /**
     * The subject the action was applied to.
     */
    readonly targetId?: string;

    /**
     * What the action changed, when `targetId` alone does not say.
     */
    readonly detail?: AuditDetail;
};

/**
 * Completion behavior for a refusal record, separate from persisted evidence.
 */
export type AuditRecordOptions = {
    /**
     * Exception to mark in the current request after durable acceptance. This refusal record
     * bypasses any ambient mutation transaction so a later rollback cannot erase its evidence.
     */
    readonly markExceptionAsAudited?: object;
};

/**
 * Contract for recording an audit entry.
 */
export interface IAuditPort {
    /**
     * Records one audit entry, completing the input with the identity, transport and correlation
     * data the caller cannot see. In a transaction, resolution confirms the insert only;
     * durability requires the outer run() to commit. Outside a transaction, waits for durable
     * acceptance. Failed writes must propagate out of the transaction callback to roll it back.
     *
     * Marked refusal records commit independently of any ambient transaction.
     *
     * @param input What happened and to whom.
     * @param options Optional refusal exception to mark after durable acceptance.
     * @throws {DependencyUnavailableException} When the audit store is unreachable
     */
    record(input: AuditRecordInput, options?: AuditRecordOptions): Promise<void>;
}
