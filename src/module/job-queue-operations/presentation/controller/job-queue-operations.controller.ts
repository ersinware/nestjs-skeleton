/**
 * @file job-queue-operations.controller.ts
 * @description Restricted HTTP access to dead-letter jobs and redrive operations.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import type { FastifyRequest } from 'fastify';
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
    ApiIdempotencyKey,
} from 'src/core/doc';
import {
    HttpCache,
    HttpCachePolicy,
    IdempotencyKey,
    QueryPaginationDto,
    RequestValidationMessage,
    ResponsePaginationDto,
} from 'src/core/http';
import { CurrentPrincipal, Permissions } from 'src/core/security/auth';
import { RateLimit, RateLimitPolicy } from 'src/core/security/rate-limiting';
import { DiscardDeadLetterJobsCommand } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/command';
import { DiscardFailedDeadLetterRedrivesCommand } from 'src/module/job-queue-operations/application/command/discard-failed-dead-letter-redrives/command';
import { StartDeadLetterRedriveCommand } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/command';
import { ListDeadLetterJobsQuery } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/query';
import { ListDeadLetterRedrivesQuery } from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/query';
import { PostDeadLetterFailedRedrivesDiscardDto } from 'src/module/job-queue-operations/presentation/dto/post-dead-letter-failed-redrives-discard.dto';
import { PostDeadLetterJobDiscardDto } from 'src/module/job-queue-operations/presentation/dto/post-dead-letter-job-discard.dto';
import { ResponseDeadLetterJobDto } from 'src/module/job-queue-operations/presentation/dto/response-dead-letter-job.dto';
import { ResponseDeadLetterRedriveDto } from 'src/module/job-queue-operations/presentation/dto/response-dead-letter-redrive.dto';
import { Permission, type Principal } from 'src/shared/domain/principal';
import { InvalidInputMessage } from 'src/shared/exception';

/**
 * Gives authorized operators sanitized dead-letter views, exact discard, and redrive control.
 */
@Controller({ path: 'job-operation/dead-letter', version: VERSION_1 })
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
    @Get('job')
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
    async listJobs(@Query() query: QueryPaginationDto): Promise<ResponsePaginationDto<ResponseDeadLetterJobDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListDeadLetterJobsQuery(query));

        return new ResponsePaginationDto(
            plainToInstance(ResponseDeadLetterJobDto, [...data]),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Lists retained dead-letter redrive operations newest first in bounded pages.
     *
     * @param query Pagination parameters
     * @returns Sanitized redrive operations and pagination metadata
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     * @throws {SystemException} When persisted job identifiers, states, or the returned page count is invalid
     */
    @Get('redrive')
    @RateLimit(RateLimitPolicy.DEFAULT)
    @Permissions(Permission.JOB_DEAD_LETTER_READ)
    @HttpCache(HttpCachePolicy.PRIVATE_REVALIDATE)
    @ApiOperation({
        summary: 'List dead-letter redrives',
        description: `Lists retained dead-letter redrives newest first. Requires '${Permission.JOB_DEAD_LETTER_READ}' permission.`,
    })
    @ApiDefaultOkResponsePaginated({
        message: 'Dead-letter redrives successfully retrieved.',
        model: ResponseDeadLetterRedriveDto,
    })
    @ApiDefaultInvalidRequestResponse(RequestValidationMessage.PARAM)
    async listRedrives(
        @Query() query: QueryPaginationDto,
    ): Promise<ResponsePaginationDto<ResponseDeadLetterRedriveDto>> {
        const { data, total } = await this.queryPipeline.execute(new ListDeadLetterRedrivesQuery(query));

        return new ResponsePaginationDto(
            plainToInstance(ResponseDeadLetterRedriveDto, [...data]),
            total,
            query.page,
            query.limit,
        );
    }

    /**
     * Requests an asynchronous redrive of all eligible shared dead-letter jobs.
     *
     * @param request HTTP request providing the method and matched route template
     * @param idempotencyKey Validated UUID v4 identifying this logical request
     * @param principal Current authenticated and authorized operator
     * @throws {InvalidInputException} When Idempotency-Key is absent or invalid
     * @throws {ResourceConflictException} When the key belongs to a different request or another redrive is queued or active
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result
     */
    @Post('redrive')
    @RateLimit(RateLimitPolicy.JOB_QUEUE_MUTATION)
    @Permissions(Permission.JOB_DEAD_LETTER_REDRIVE)
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary: 'Redrive dead-letter jobs',
        description: `Starts an exclusive operation that returns eligible jobs to their original queues. Requires '${Permission.JOB_DEAD_LETTER_REDRIVE}' permission. Retry an ambiguous outcome with the same Idempotency-Key; retained same-key requests replay 202 without enqueueing or auditing again. Authentication, authorization, and rate limiting apply on every retry.`,
    })
    @ApiIdempotencyKey()
    @ApiAcceptedResponse({ description: 'Redrive operation accepted.' })
    @ApiDefaultInvalidRequestResponse(InvalidInputMessage.IDEMPOTENCY_KEY)
    @ApiDefaultResourceConflictResponse()
    async redrive(
        @Req() request: FastifyRequest,
        @IdempotencyKey() idempotencyKey: string,
        @CurrentPrincipal() principal: Principal,
    ) {
        await this.commandPipeline.execute(
            new StartDeadLetterRedriveCommand({
                key: idempotencyKey,
                canonicalValue: JSON.stringify([
                    request.method,
                    request.routeOptions.url!,
                    principal.type,
                    principal.id,
                ]),
            }),
        );
    }

    /**
     * Discards an exact set of retained failed dead-letter redrive operations as one audited mutation.
     *
     * @param request HTTP request providing the method and matched route template
     * @param idempotencyKey Validated UUID v4 identifying this logical request
     * @param principal Current authenticated and authorized operator
     * @param body Validated redrive operation identifiers
     * @throws {InvalidInputException} When Idempotency-Key or request validation fails
     * @throws {ResourceNotFoundException} When any requested operation is absent or no longer retained
     * @throws {ResourceConflictException} When the key belongs to a different request or any requested operation is not failed
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an unknown or invalid mutation outcome
     */
    @Post('redrive/discard')
    @RateLimit(RateLimitPolicy.JOB_QUEUE_MUTATION)
    @Permissions(Permission.JOB_DEAD_LETTER_DISCARD)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Discard failed dead-letter redrives',
        description: `Atomically discards the specified retained failed dead-letter redrives. Only redrives in FAILED status may be discarded. Requires '${Permission.JOB_DEAD_LETTER_DISCARD}' permission. Reuse the same Idempotency-Key after an ambiguous outcome; retained same-key requests replay 204 without repeating the mutation or audit. Current authentication, authorization, and rate limits still apply.`,
    })
    @ApiIdempotencyKey()
    @ApiNoContentResponse({ description: 'Every requested failed dead-letter redrive was discarded.' })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse()
    async discardFailedRedrives(
        @Req() request: FastifyRequest,
        @IdempotencyKey() idempotencyKey: string,
        @CurrentPrincipal() principal: Principal,
        @Body() body: PostDeadLetterFailedRedrivesDiscardDto,
    ) {
        await this.commandPipeline.execute(
            new DiscardFailedDeadLetterRedrivesCommand(
                {
                    key: idempotencyKey,
                    canonicalValue: JSON.stringify([
                        request.method,
                        request.routeOptions.url!,
                        principal.type,
                        principal.id,
                        [...body.ids].sort(),
                    ]),
                },
                body.ids,
            ),
        );
    }

    /**
     * Discards an exact set of dead-letter jobs as one audited operation.
     *
     * @param request HTTP request providing the method and matched route template
     * @param idempotencyKey Validated UUID v4 identifying this logical request
     * @param principal The verified principal of the current request
     * @param body Validated dead-letter job identifiers
     * @throws {ResourceConflictException} When the key belongs to a different request
     * @throws {InvalidInputException} When the idempotency key is absent or invalid, or request validation fails
     * @throws {ResourceNotFoundException} When any requested job is missing from the shared dead-letter queue
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result
     */
    @Post('job/discard')
    @RateLimit(RateLimitPolicy.JOB_QUEUE_MUTATION)
    @Permissions(Permission.JOB_DEAD_LETTER_DISCARD)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Discard dead-letter jobs',
        description: `Atomically discards the specified dead-letter jobs. Requires '${Permission.JOB_DEAD_LETTER_DISCARD}' permission. Reuse the same Idempotency-Key after an ambiguous outcome; retained same-key requests replay 204 without repeating the mutation, audit, or jobs. Current authentication, authorization, and rate limits still apply.`,
    })
    @ApiIdempotencyKey()
    @ApiNoContentResponse({ description: 'Every requested dead-letter job was discarded.' })
    @ApiDefaultInvalidRequestResponse()
    @ApiDefaultResourceNotFoundResponse()
    @ApiDefaultResourceConflictResponse()
    async discardJobs(
        @Req() request: FastifyRequest,
        @IdempotencyKey() idempotencyKey: string,
        @CurrentPrincipal() principal: Principal,
        @Body() body: PostDeadLetterJobDiscardDto,
    ) {
        await this.commandPipeline.execute(
            new DiscardDeadLetterJobsCommand(
                {
                    key: idempotencyKey,
                    canonicalValue: JSON.stringify([
                        request.method,
                        request.routeOptions.url!,
                        principal.type,
                        principal.id,
                        [...body.ids].sort(),
                    ]),
                },
                body.ids,
            ),
        );
    }
}
