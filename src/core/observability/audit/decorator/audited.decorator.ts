/**
 * @file audited.decorator.ts
 * @description Decorator marking a read/disclosure endpoint as audit-worthy.
 */

import { SetMetadata } from '@nestjs/common';
import { AuditAction } from 'src/core/observability/audit/audit-action.enum';

/**
 * Metadata key under which the audited action is stored for the interceptor to read.
 */
export const KEY_DECORATOR_AUDITED = 'KEY_DECORATOR_AUDITED';

/**
 * Marks a controller action whose successful execution must produce an audit record.
 *
 * ONLY for endpoints that disclose data and write nothing — the interceptor records the
 * disclosure. NEVER on a mutating endpoint: that record is the command handler's, written beside
 * the entity write. Machine-unenforceable; a code-review rule.
 *
 * @param action The audit action recorded when the decorated handler completes successfully.
 * @returns A decorator storing the action as route metadata for the audit interceptor.
 */
export const Audited = (action: AuditAction) => SetMetadata(KEY_DECORATOR_AUDITED, action);
