/**
 * @file index.ts
 * @description Public entry point of the audit concern. Nothing outside may import past this barrel.
 */

export { AuditAction } from 'src/core/observability/audit/audit-action.enum';
export { publishAuditActor } from 'src/core/observability/audit/audit-context';
export type { AuditContext } from 'src/core/observability/audit/audit-context';
export { audit } from 'src/core/observability/audit/audit.schema';
export { Audited } from 'src/core/observability/audit/decorator/audited.decorator';
export { auditContextHook } from 'src/core/observability/audit/hook/audit-context.hook';
export { AuditInterceptor } from 'src/core/observability/audit/interceptor/audit.interceptor';
export { AuditModule } from 'src/core/observability/audit/module';
export { TOKEN_AUDIT_PORT } from 'src/core/observability/audit/port/audit.port';
export type { AuditRecordInput, IAuditPort } from 'src/core/observability/audit/port/audit.port';
