/**
 * @file audit.port.ts
 * @description Contract for writing audit records, kept separate from the logging contract on purpose.
 */

import { AuditAction } from 'src/core/observability/audit/audit-action.enum';

/**
 * Dependency injection token representing the {@link IAuditPort} contract.
 */
export const TOKEN_AUDIT_PORT = Symbol('TOKEN_AUDIT_PORT');

/**
 * What an action changed, beyond what its ids say. Bounded on purpose: values are identifiers and
 * enum members only, so a record can never carry a token, a password or personal data.
 */
export type AuditDetail = Readonly<Record<string, string | readonly string[]>>;

/**
 * What the caller supplies — the meaning of the event and nothing else. IP, user agent and trace
 * are the adapter's to fill from the ambient context. No success/failure field: each
 * {@link AuditAction} states its own outcome.
 */
export type AuditRecordInput = {
    /** What happened, outcome included; the record's only required fact. */
    readonly action: AuditAction;

    /** Why a refusal happened; meaningless on an action that cannot fail. */
    readonly reason?: string;

    /** The subject the action was applied to. */
    readonly targetId?: string;

    /** What the action changed, when `targetId` alone does not say. */
    readonly detail?: AuditDetail;
};

/**
 * Contract for recording an audit entry.
 */
export interface IAuditPort {
    /**
     * Records one audit entry, completing the input with the identity, transport and correlation
     * data the caller cannot see. Resolves only once the record is durable; a failed write fails
     * the caller.
     *
     * @param input What happened and to whom.
     * @throws {DependencyUnavailableException} When the audit store is unreachable
     */
    record(input: AuditRecordInput): Promise<void>;
}
