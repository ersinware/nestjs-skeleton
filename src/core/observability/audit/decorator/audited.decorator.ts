/**
 * @file audited.decorator.ts
 * @description Decorator that marks a READ/disclosure endpoint as audit-worthy, so the audit
 * interceptor records the given action after the handler succeeds.
 */

import { SetMetadata } from '@nestjs/common';
import { AuditAction } from 'src/core/observability/audit/audit-action.enum';

/**
 * Metadata key under which the audited action is stored for the interceptor to read.
 */
export const KEY_DECORATOR_AUDITED = 'KEY_DECORATOR_AUDITED';

/**
 * Marks a controller action as one whose successful execution must produce an audit record.
 *
 * This is ONLY for endpoints that read or disclose data and write nothing — a personal-data export
 * is the archetype. The audited fact there is the disclosure over the wire itself, and there is no
 * state write to attach the record to, so the interceptor is the code that establishes the fact.
 *
 * It must NEVER be placed on an endpoint that mutates state. A command writes its own audit record
 * next to its entity write, so the two can never diverge; auditing a write from the edge would
 * reintroduce exactly the split the handler-writes-its-own-record rule exists to prevent, and the
 * two records could disagree. This constraint cannot be enforced by the machine — it is a
 * code-review rule.
 *
 * @param action The audit action recorded when the decorated handler completes successfully.
 * @returns A decorator storing the action as route metadata for the audit interceptor.
 */
export const Audited = (action: AuditAction) => SetMetadata(KEY_DECORATOR_AUDITED, action);
