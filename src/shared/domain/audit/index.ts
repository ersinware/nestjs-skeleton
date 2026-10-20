/**
 * @file index.ts
 * @description Public domain refusal audit vocabulary, independent of persistence and transport.
 */

export { defineAuditAction, type AuditAction } from 'src/shared/domain/audit/audit-action';
export { AuditReason } from 'src/shared/domain/audit/audit-reason.enum';
export { DomainFailureAuditAction } from 'src/shared/domain/audit/domain-failure-audit-action';
