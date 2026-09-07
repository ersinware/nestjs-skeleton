/**
 * @file audit-trail.module.ts
 * @description NestJS wiring of the audit trail bounded context.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { GetAuditTrailRecordByIdQueryHandler } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/handler';
import { TOKEN_GET_AUDIT_TRAIL_RECORD_BY_ID_PORT } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/port';
import { ListAuditTrailRecordsQueryHandler } from 'src/module/audit-trail/application/query/list-audit-trail-records/handler';
import { TOKEN_LIST_AUDIT_TRAIL_RECORDS_PORT } from 'src/module/audit-trail/application/query/list-audit-trail-records/port';
import { AuditTrailReplicaReaderAdapter } from 'src/module/audit-trail/infrastructure/adapter/audit-trail-replica-reader.adapter';
import { AuditTrailController } from 'src/module/audit-trail/presentation/controller/audit-trail.controller';

/**
 * Wires the audit trail bounded context: a read-only view over the core-owned `audit.audit` table.
 * No writer, domain or facade: nothing mutates the trail here and no other context reads it.
 */
@Module({
    imports: [CqrsPipelineModule, DatabaseModule],
    controllers: [AuditTrailController],
    providers: [
        ListAuditTrailRecordsQueryHandler,
        GetAuditTrailRecordByIdQueryHandler,
        { provide: TOKEN_LIST_AUDIT_TRAIL_RECORDS_PORT, useClass: AuditTrailReplicaReaderAdapter },
        { provide: TOKEN_GET_AUDIT_TRAIL_RECORD_BY_ID_PORT, useClass: AuditTrailReplicaReaderAdapter },
    ],
})
export class AuditTrailModule {}
