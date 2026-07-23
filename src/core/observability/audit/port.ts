/**
 * @file port.ts
 * @description Contract for writing audit records, kept separate from the logging contract on purpose.
 */

import { AuditRecordInput } from 'src/core/observability/audit/audit-entry';

export const TOKEN_AUDIT_PORT = Symbol('TOKEN_AUDIT_PORT');

/**
 * Contract for recording an audit entry.
 *
 * This exists as its own port rather than as a level on {@link ILoggerPort} because the two answer
 * to different audiences under different rules. An operational log speaks to an operator, may be
 * dropped, and is legitimately silenced by a level or environment setting; an audit record speaks
 * to an auditor, is bound by a retention policy, and must survive every such decision. While both
 * travelled the same pipe, raising the production log level to `warn` — an ordinary operational
 * call — would have silently erased every login audit record, and `NODE_ENV=test` silencing meant
 * no test could assert that an action was audited at all.
 */
export interface IAuditPort {
    /**
     * Records one audit entry, completing the caller's input with the identity, transport and
     * correlation data the caller cannot see.
     *
     * @param input The meaning of the event — what happened and to whom.
     */
    record(input: AuditRecordInput): void;
}
