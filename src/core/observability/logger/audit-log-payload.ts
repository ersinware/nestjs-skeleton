/**
 * @file audit-log-payload.ts
 * @description Audit-specific log payload class, automatically tagging every entry with 'AUDIT'.
 */

import { AuditLogAction } from 'src/core/observability/logger/audit-log-action.enum';
import { LogPayload } from 'src/core/observability/logger/log-payload';

/**
 * Custom log payload representing an Audit Log entry.
 * Automatically sets type to 'AUDIT'.
 * Written by whoever can classify the event as audit-worthy, never inferred from a caught exception.
 */
export class AuditLogPayload extends LogPayload {
    /**
     * Creates an instance of AuditLogPayload.
     *
     * @param payload The audit log parameters.
     */
    constructor(payload: { class: string; method: string; action: AuditLogAction } & Record<string, unknown>) {
        super({ ...payload, type: 'AUDIT' });
    }
}
