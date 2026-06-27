/**
 * @file health.controller.ts
 * @description Exposes a health probe endpoint for external orchestration services (like load balancers or Kubernetes) to monitor the application's operational state. Standard rate-limiting is bypassed here to ensure that automated health checks are never blocked under high traffic conditions.
 */

import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/doc/decorator/api-default-internal-server-error-response.decorator';
import { ApiDefaultServiceUnavailableResponse } from 'src/common/doc/decorator/api-default-service-unavailable-response.decorator';
import { Public } from 'src/common/auth/decorator/public.decorator';
import { ResponseHealthyDto } from './dto/response-healthy.dto';
import { ResponseUnhealthyDto } from './dto/response-unhealthy.dto';
import { HealthService } from './health.service';

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
     * Injects the underlying health service to execute checks against the database, cache, and system memory.
     *
     * @param healthService The service responsible for managing and executing health indicators
     */
    constructor(private readonly healthService: HealthService) {}

    /**
     * Evaluates the application and dependency statuses by checking memory limits, database connectivity, and Redis availability.
     * This endpoint is critical for readiness probes that determine if the application is fully booted and operational.
     *
     * @returns The resolved health check result payload containing the status of all evaluated indicators
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
    @ApiDefaultServiceUnavailableResponse()
    async check(): Promise<ResponseHealthyDto | ResponseUnhealthyDto> {
        return plainToInstance(ResponseHealthyDto, await this.healthService.check());
    }
}
