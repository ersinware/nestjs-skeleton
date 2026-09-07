/**
 * @file module.ts
 * @description NestJS module wiring the audit port to its database-backed adapter.
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/core/database';
import { AuditAdapter } from 'src/core/observability/audit/adapter/audit.adapter';
import { TOKEN_AUDIT_PORT } from 'src/core/observability/audit/port/audit.port';

/**
 * Provides the audit port backed by the database adapter.
 */
@Module({
    imports: [DatabaseModule],
    providers: [
        {
            provide: TOKEN_AUDIT_PORT,
            useClass: AuditAdapter,
        },
    ],
    exports: [TOKEN_AUDIT_PORT],
})
export class AuditModule {}
