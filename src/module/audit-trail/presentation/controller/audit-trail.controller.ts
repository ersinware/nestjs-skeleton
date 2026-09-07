/**
 * @file audit-trail.controller.ts
 * @description Read-only HTTP endpoints over the audit trail, restricted to super-admins.
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultDependencyUnavailableResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultOkResponsePaginated,
    ApiDefaultResourceNotFoundResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import {
    HttpCache,
    HttpCachePolicy,
    ParamIdDto,
    RequestValidationMessage,
    ResponsePaginationDto,
    ROUTE_PARAM_ID,
} from 'src/core/http';
import { AuditAction, Audited } from 'src/core/observability/audit';
import { Roles } from 'src/core/security/auth';
import { GetAuditTrailRecordByIdQuery } from 'src/module/audit-trail/application/query/get-audit-trail-record-by-id/query';
import { ListAuditTrailRecordsQuery } from 'src/module/audit-trail/application/query/list-audit-trail-records/query';
import { QueryAuditTrailDto } from 'src/module/audit-trail/presentation/dto/query-audit-trail.dto';
import { ResponseAuditTrailRecordSummaryDto } from 'src/module/audit-trail/presentation/dto/response-audit-trail-record-summary.dto';
import { ResponseAuditTrailRecordDto } from 'src/module/audit-trail/presentation/dto/response-audit-trail-record.dto';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * The operator view of the audit trail. Read-only: the trail is append-only evidence. Every read is
 * itself audited, since who inspected the trail is evidence too.
 */
@Controller({
    path: 'audit-trail',
    version: VERSION_1,
})
@ApiTags('audit-trail')
@Roles(AdminRole.SUPER_ADMIN)
@Audited(AuditAction.AUDIT_TRAIL_ACCESSED)
@ApiBearerAuth()
@ApiDefaultUnauthenticatedResponse()
@ApiDefaultAccessDeniedResponse()
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultDependencyUnavailableResponse()
export class AuditTrailController {
    /**
     * @param queryPipeline The CQRS query pipeline
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Lists audit trail record summaries, newest first, narrowed by the optional filters.
     *
     * @param query The filter and pagination parameters
     * @returns The paginated list of record summaries
     */
    @Get()
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiOperation({
        summary: 'List audit trail records',
        description:
            'Retrieves audit trail records newest first, filterable by action, actor, target and time range. Requires super-administrator authorization.',
    })
    @ApiDefaultOkResponsePaginated({
        message: 'Audit trail records successfully retrieved.',
        model: ResponseAuditTrailRecordSummaryDto,
    })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    async findAll(
        @Query() query: QueryAuditTrailDto,
    ): Promise<ResponsePaginationDto<ResponseAuditTrailRecordSummaryDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListAuditTrailRecordsQuery(query));

        return new ResponsePaginationDto<ResponseAuditTrailRecordSummaryDto>(
            plainToInstance(ResponseAuditTrailRecordSummaryDto, data),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Retrieves one audit trail record by ID.
     *
     * @param params The path parameters carrying the record ID
     * @returns The requested record
     */
    @Get(ROUTE_PARAM_ID)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiOperation({
        summary: 'Get audit trail record by ID',
        description: 'Retrieves a single audit trail record. Requires super-administrator authorization.',
    })
    @ApiOkResponse({ description: 'Audit trail record successfully retrieved.', type: ResponseAuditTrailRecordDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async findOne(@Param() params: ParamIdDto): Promise<ResponseAuditTrailRecordDto> {
        return plainToInstance(
            ResponseAuditTrailRecordDto,
            await this.queryPipeline.execute(new GetAuditTrailRecordByIdQuery(params.id)),
        );
    }
}
