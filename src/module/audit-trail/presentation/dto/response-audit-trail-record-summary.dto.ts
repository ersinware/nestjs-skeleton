/**
 * @file response-audit-trail-record-summary.dto.ts
 * @description Response schema for one row of the audit trail listing.
 */

import { ApiSchema, PickType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { ResponseAuditTrailRecordDto } from 'src/module/audit-trail/presentation/dto/response-audit-trail-record.dto';

/**
 * The listing row: only the fields that identify an event. Picked from the full record so the two
 * schemas cannot drift.
 */
@Exclude()
@ApiSchema({ name: 'ResponseAuditTrailRecordSummary', description: 'One row of the audit trail listing.' })
export class ResponseAuditTrailRecordSummaryDto extends PickType(ResponseAuditTrailRecordDto, [
    'id',
    'action',
    'targetId',
    'actorId',
    'occurredAt',
] as const) {}
