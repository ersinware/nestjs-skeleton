/**
 * @file audit-log-payload.ts
 * @description Audit-specific log payload class, automatically tagging every entry with 'AUDIT'.
 */

import { AuditLogAction } from './enum/audit-log-action.enum';
import { LogPayload } from './log-payload';

/**
 * Custom log payload representing an Audit Log entry.
 * Automatically sets type to 'AUDIT'.
 * Intended to be passed inside standard HttpException 'cause' options.
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
