/**
 * @file module.ts
 * @description NestJS module wiring the audit port to its pino-backed adapter.
 */

import { Global, Module } from '@nestjs/common';
import { AuditAdapter } from 'src/core/observability/audit/adapter';
import { TOKEN_AUDIT_PORT } from 'src/core/observability/audit/port';

/**
 * Global module providing the audit port.
 *
 * Global because audit records are written from every layer that can establish an auditable fact —
 * command handlers, the global exception filter, and later a read-side interceptor — and requiring
 * each of them to import a module would make forgetting the record easier, not harder.
 */
@Global()
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
