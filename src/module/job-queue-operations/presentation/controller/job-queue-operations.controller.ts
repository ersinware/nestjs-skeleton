/**
 * @file job-queue-operations.controller.ts
 * @description Restricted HTTP access to dead-letter jobs and redrive operations.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
    ApiAcceptedResponse,
    ApiBearerAuth,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { VERSION_1 } from 'src/core/config';
import { CommandPipeline, QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultDependencyUnavailableResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultInvalidRequestResponse,
    ApiDefaultOkResponsePaginated,
    ApiDefaultRateLimitedResponse,
    ApiDefaultResourceConflictResponse,
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
import { Permissions } from 'src/core/security/auth';
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';
import { DiscardDeadLetterJobsCommand } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/command';
import { StartDeadLetterRedriveCommand } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/command';
import { GetDeadLetterJobQuery } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/query';
import { GetDeadLetterRedriveStatusQuery } from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive-status/query';
import { ListDeadLetterJobsQuery } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/query';
import { ParamDeadLetterJobIdDto } from 'src/module/job-queue-operations/presentation/dto/param-dead-letter-job-id.dto';
import { ParamDeadLetterRedriveOperationIdDto } from 'src/module/job-queue-operations/presentation/dto/param-dead-letter-redrive-operation-id.dto';
import { PostDeadLetterDiscardDto } from 'src/module/job-queue-operations/presentation/dto/post-dead-letter-discard.dto';
import { ResponseDeadLetterJobDto } from 'src/module/job-queue-operations/presentation/dto/response-dead-letter-job.dto';
import { ResponseDeadLetterRedriveAcceptedDto } from 'src/module/job-queue-operations/presentation/dto/response-dead-letter-redrive-accepted.dto';
import { ResponseDeadLetterRedriveStatusDto } from 'src/module/job-queue-operations/presentation/dto/response-dead-letter-redrive-status.dto';
import { Permission } from 'src/shared/domain/principal';

/**
 * Gives authorized operators sanitized dead-letter views, exact discard, and redrive control.
 */
@Controller({ path: 'job-operations/dead-letter', version: VERSION_1 })
@ApiTags('job-queue-operations')
@ApiBearerAuth()
@ApiDefaultUnauthenticatedResponse()
@ApiDefaultAccessDeniedResponse()
@ApiDefaultRateLimitedResponse()
@ApiDefaultInternalServerErrorResponse()
@ApiDefaultDependencyUnavailableResponse()
export class JobQueueOperationsController {
    /**
     * Initializes the controller with the command and query pipelines.
     *
     * @param commandPipeline CQRS command pipeline
     * @param queryPipeline CQRS query pipeline
     */
    constructor(
        private readonly commandPipeline: CommandPipeline,
        private readonly queryPipeline: QueryPipeline,
    ) {}

    /**
     * Lists newest dead-letter jobs in bounded pages.
     *
     * @param query Pagination parameters
     * @returns Sanitized jobs and pagination metadata
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job metadata or the returned page count is invalid
     */
    @Get('jobs')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.JOB_DEAD_LETTER_READ)
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
     * @throws {ResourceNotFoundException} When the job is absent from the shared queue
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job provenance, identifiers, or timestamps are invalid
     */
    @Get('jobs/:id')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.JOB_DEAD_LETTER_READ)
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

    /**
     * Requests an asynchronous redrive of all eligible shared dead-letter jobs.
     *
     * @returns Identifier of the accepted operation
     * @throws {ResourceConflictException} When another redrive is queued or active
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result
     */
    @Post('redrive')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.JOB_DEAD_LETTER_REDRIVE)
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary: 'Redrive dead-letter jobs',
        description: `Starts an exclusive operation that returns eligible jobs to their original queues. Requires '${Permission.JOB_DEAD_LETTER_REDRIVE}' permission.`,
    })
    @ApiAcceptedResponse({ description: 'Redrive operation accepted.', type: ResponseDeadLetterRedriveAcceptedDto })
    @ApiDefaultResourceConflictResponse('A dead-letter redrive is already in progress.')
    async redrive(): Promise<ResponseDeadLetterRedriveAcceptedDto> {
        const operationId = await this.commandPipeline.execute(new StartDeadLetterRedriveCommand());

        return plainToInstance(ResponseDeadLetterRedriveAcceptedDto, { operationId });
    }

    /**
     * Reads the retained status of one redrive operation.
     *
     * @param params Validated redrive operation identifier
     * @returns Current operation state and timestamps
     * @throws {ResourceNotFoundException} When the operation is absent or no longer retained
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    @Get('redrive/:operationId')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.JOB_DEAD_LETTER_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiOperation({
        summary: 'Get dead-letter redrive status',
        description: `Reads the status of one retained redrive operation. Requires '${Permission.JOB_DEAD_LETTER_READ}' permission.`,
    })
    @ApiOkResponse({ description: 'Redrive operation status retrieved.', type: ResponseDeadLetterRedriveStatusDto })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    @ApiDefaultResourceNotFoundResponse()
    async getRedriveStatus(
        @Param() params: ParamDeadLetterRedriveOperationIdDto,
    ): Promise<ResponseDeadLetterRedriveStatusDto> {
        return plainToInstance(
            ResponseDeadLetterRedriveStatusDto,
            await this.queryPipeline.execute(new GetDeadLetterRedriveStatusQuery(params.operationId)),
        );
    }

    /**
     * Discards an exact set of dead-letter jobs as one audited operation.
     *
     * @param body Validated dead-letter job identifiers
     * @throws {ResourceNotFoundException} When any requested job is missing from the shared dead-letter queue
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result
     */
    @Post('discard')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.JOB_DEAD_LETTER_DISCARD)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Discard dead-letter jobs',
        description: `Atomically discards the specified dead-letter jobs. Requires '${Permission.JOB_DEAD_LETTER_DISCARD}' permission.`,
    })
    @ApiNoContentResponse({ description: 'Every requested dead-letter job was discarded.' })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PAYLOAD)
    @ApiDefaultResourceNotFoundResponse()
    async discard(@Body() body: PostDeadLetterDiscardDto) {
        await this.commandPipeline.execute(new DiscardDeadLetterJobsCommand(body.jobIds));
    }
}
