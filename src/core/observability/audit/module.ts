/**
 * @file module.ts
 * @description NestJS module wiring the audit port to its pino-backed adapter.
 */

import { Module } from '@nestjs/common';
import { AuditAdapter } from 'src/core/observability/audit/adapter';
import { TOKEN_AUDIT_PORT } from 'src/core/observability/audit/port';

/**
 * Module providing the audit port.
 *
 * Every consumer that establishes an auditable fact — command handlers, the global exception filter,
 * and later a read-side interceptor — imports this module explicitly, so the dependency is visible in
 * that consumer's own manifest rather than resolved from an ambient global scope.
 */
@Module({
    providers: [
        {
            provide: TOKEN_AUDIT_PORT,
            useClass: AuditAdapter,
        },
    ],
    exports: [TOKEN_AUDIT_PORT],
})
export class AuditModule {}
