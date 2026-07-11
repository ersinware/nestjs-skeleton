/**
 * @file health.controller.ts
 * @description Exposes a health probe endpoint for external orchestration services (like load balancers or Kubernetes) to monitor the application's operational state. Standard rate-limiting is bypassed here to ensure that automated health checks are never blocked under high traffic conditions.
 */

import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { ApiDefaultInternalServerErrorResponse } from 'src/core/doc';
import { ServiceUnavailableType } from 'src/core/exception';
import { Public } from 'src/core/security';
import {
    GetHealthStatusQuery,
    type GetHealthStatusResult,
} from 'src/module/health/application/query/get-health-status';
import { ResponseHealthyDto } from 'src/module/health/presentation/dto/response-healthy.dto';
import { ResponseUnhealthyDto } from 'src/module/health/presentation/dto/response-unhealthy.dto';

/**
 * The controller exposing endpoints to verify the operational state of the service and its key dependencies.
 * Used to confirm that the application is capable of handling incoming requests successfully.
 */
@Controller({
    path: 'health',
    version: VERSION_NEUTRAL,
})
@SkipThrottle()
@Public()
@ApiTags('health')
@ApiDefaultInternalServerErrorResponse()
export class HealthController {
    /**
     * Injects the underlying query bus to execute health check queries.
     *
     * @param queryBus The command-query responsibility segregation query bus.
     */
    constructor(private readonly queryBus: QueryBus) {}

    /**
     * Evaluates the application and dependency statuses by checking memory limits, database connectivity, and Redis availability.
     * This endpoint is critical for readiness probes that determine if the application is fully booted and operational.
     *
     * @returns The resolved health check result payload containing the status of all evaluated indicators
     * @throws {ServiceUnavailableException} If one or more health indicators fail.
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
        description: ServiceUnavailableType.DEFAULT,
        type: ResponseUnhealthyDto,
    })
    async getStatus(): Promise<ResponseHealthyDto> {
        return plainToInstance(
            ResponseHealthyDto,
            await this.queryBus.execute<GetHealthStatusQuery, GetHealthStatusResult>(new GetHealthStatusQuery()),
        );
    }
}
