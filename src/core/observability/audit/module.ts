/**
 * @file module.ts
 * @description NestJS module wiring the audit port to its pino-backed adapter.
 */

import { Module } from '@nestjs/common';
import { AuditAdapter } from 'src/core/observability/audit/adapter/audit.adapter';
import { TOKEN_AUDIT_PORT } from 'src/core/observability/audit/port/audit.port';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Provides the audit port backed by the pino adapter.
 */
@Module({
    // The adapter injects `PinoLogger`, whose configured instance `LoggerModule` provides; the
    // manifest names the dependency even though nestjs-pino is global.
    imports: [LoggerModule],
    providers: [
        {
            provide: TOKEN_AUDIT_PORT,
            useClass: AuditAdapter,
        },
    ],
    exports: [TOKEN_AUDIT_PORT],
})
export class AuditModule {}
