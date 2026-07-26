/**
 * @file health.controller.ts
 * @description Exposes a health probe endpoint for external orchestration services (like load balancers or Kubernetes) to monitor the application's operational state. Standard rate-limiting is bypassed here to ensure that automated health checks are never blocked under high traffic conditions.
 */

import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { ROUTE_HEALTH } from 'src/core/config';
import { QueryPipeline } from 'src/core/cqrs';
import { ApiDefaultInternalServerErrorResponse } from 'src/core/doc';
import { Public } from 'src/core/security/auth';
import { GetHealthStatusQuery } from 'src/module/health/application/query/get-health-status/query';
import { ResponseHealthyDto } from 'src/module/health/presentation/dto/response-healthy.dto';
import { ResponseUnhealthyDto } from 'src/module/health/presentation/dto/response-unhealthy.dto';
import { DependencyUnavailableMessage } from 'src/shared/exception';

/**
 * The controller exposing endpoints to verify the operational state of the service and its key dependencies.
 * Used to confirm that the application is capable of handling incoming requests successfully.
 */
@Controller({
    path: ROUTE_HEALTH,
    version: VERSION_NEUTRAL,
})
@SkipThrottle()
@Public()
@ApiTags('health')
@ApiDefaultInternalServerErrorResponse()
export class HealthController {
    /**
     * Injects the query pipeline to execute health check queries. The health query is deliberately
     * non-cacheable, so the pipeline passes it straight through to the handler — routing every edge
     * through the pipeline keeps the "no query bypasses the behavior chain" invariant intact.
     *
     * @param queryPipeline The CQRS query pipeline.
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Evaluates the application and dependency statuses by checking memory limits, database connectivity, and Redis availability.
     * This endpoint is critical for readiness probes that determine if the application is fully booted and operational.
     *
     * @returns The resolved health check result payload containing the status of all evaluated indicators
     * @throws {DependencyUnavailableException} If one or more health indicators fail.
     */
    @Get()
    @ApiOperation({
        summary: 'Health check',
        description: 'Returns the health status of the API service and its dependencies.',
    })
    @ApiOkResponse({
        description: 'Service is fully healthy.',
        type: ResponseHealthyDto,
    })
    @ApiServiceUnavailableResponse({
        description: DependencyUnavailableMessage.DEFAULT,
        type: ResponseUnhealthyDto,
    })
    async getStatus(): Promise<ResponseHealthyDto> {
        return plainToInstance(ResponseHealthyDto, await this.queryPipeline.execute(new GetHealthStatusQuery()));
    }
}
