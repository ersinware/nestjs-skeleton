/**
 * @file health.controller.ts
 * @description Controller exposing health probe endpoint to monitor application state.
 * Bypasses standard rate-limiting to prevent health checker blocking.
 */

import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiDefaultInternalServerErrorResponse } from 'src/common/decorator/api-default-internal-server-error-response.decorator';
import { ApiDefaultServiceUnavailableResponse } from 'src/common/decorator/api-default-service-unavailable-response.decorator';
import { Public } from 'src/common/decorator/public.decorator';
import { HealthyDto } from './dto/healthy.dto';
import { UnhealthyDto } from './dto/unhealthy.dto';
import { HealthService } from './health.service';

/**
 * Controller exposing endpoints to verify the operational state of the service and its key dependencies.
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
     * Creates an instance of HealthController.
     *
     * @param healthService The service managing health checks.
     */
    constructor(private readonly healthService: HealthService) {}

    /**
     * Endpoint to check application and dependency status.
     * Evaluates memory limits, database connectivity, and Redis status.
     *
     * @returns A promise that resolves to HealthyDto (200 OK) or UnhealthyDto (503 Service Unavailable).
     */
    @Get()
    @ApiOperation({
        summary: 'Health check',
        description: 'Returns the health status of the API service and its dependencies.',
    })
    @ApiOkResponse({
        description: 'Service is fully healthy.',
        type: HealthyDto,
    })
    @ApiDefaultServiceUnavailableResponse()
    check(): Promise<HealthyDto | UnhealthyDto> {
        return this.healthService.check() as Promise<HealthyDto | UnhealthyDto>;
    }
}
