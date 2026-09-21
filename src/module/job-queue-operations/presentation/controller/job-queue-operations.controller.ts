/**
 * @file job-queue-operations.controller.ts
 * @description Restricted, audited read-only HTTP access to dead-letter jobs.
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
    QueryPaginationDto,
    RequestValidationMessage,
    ResponsePaginationDto,
} from 'src/core/http';
import { AuditAction, Audited } from 'src/core/observability/audit';
import { Permissions } from 'src/core/security/auth';
import { GetDeadLetterJobQuery } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/query';
import { ListDeadLetterJobsQuery } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/query';
import { ParamDeadLetterJobIdDto } from 'src/module/job-queue-operations/presentation/dto/param-dead-letter-job-id.dto';
import { ResponseDeadLetterJobDto } from 'src/module/job-queue-operations/presentation/dto/response-dead-letter-job.dto';
import { Permission } from 'src/shared/domain/principal';

/**
 * Gives authorized operators sanitized dead-letter views and records each disclosure.
 */
@Controller({ path: 'job-operations/dead-letter', version: VERSION_1 })
@Permissions(Permission.JOB_DEAD_LETTER_READ)
@Audited(AuditAction.JOB_DEAD_LETTER_ACCESSED)
@ApiTags('job-queue-operations')
@ApiBearerAuth()
@ApiDefaultUnauthenticatedResponse()
@ApiDefaultAccessDeniedResponse()
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultDependencyUnavailableResponse()
export class JobQueueOperationsController {
    /**
     * Initializes the controller with the query pipeline.
     *
     * @param queryPipeline CQRS query pipeline
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Lists newest dead-letter jobs in bounded pages.
     *
     * @param query Pagination parameters
     * @returns Sanitized jobs and pagination metadata
     */
    @Get('jobs')
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiOperation({
        summary: 'List dead-letter jobs',
        description: `Lists sanitized dead-letter metadata newest first. Requires '${Permission.JOB_DEAD_LETTER_READ}' permission.`,
    })
    @ApiDefaultOkResponsePaginated({
        message: 'Dead-letter jobs successfully retrieved.',
        model: ResponseDeadLetterJobDto,
    })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    async list(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<ResponseDeadLetterJobDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListDeadLetterJobsQuery(query));

        return new ResponsePaginationDto(
            plainToInstance(ResponseDeadLetterJobDto, [...data]),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Reads one dead-letter job by ID.
     *
     * @param params Validated job identifier
     * @returns Sanitized dead-letter job
     */
    @Get('jobs/:id')
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiOperation({
        summary: 'Get dead-letter job',
        description: `Reads sanitized metadata for one dead-letter job. Requires '${Permission.JOB_DEAD_LETTER_READ}' permission.`,
    })
    @ApiOkResponse({ description: 'Dead-letter job successfully retrieved.', type: ResponseDeadLetterJobDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async getById(@Param() params: ParamDeadLetterJobIdDto): Promise<ResponseDeadLetterJobDto> {
        return plainToInstance(
            ResponseDeadLetterJobDto,
            await this.queryPipeline.execute(new GetDeadLetterJobQuery(params.id)),
        );
    }
}
